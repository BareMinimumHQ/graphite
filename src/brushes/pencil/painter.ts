// Draws the pencil: its strokes into a float buffer, then one paper pass per shading layer.
import { FIELD_HEIGHT, FIELD_WIDTH } from '../../core/constants.js'
import {
  brushSources,
  composeShader,
  preludeShader,
  vertexShader,
} from '../../generated/shaders.js'
import type { BrushContext, BrushPainter } from '../../core/brush.js'
import { createStrokeBuffer } from '../../utilities/stroke-buffer.js'
import {
  cullMargin,
  farness,
  SECTIONS,
  strokeGrid,
} from '../../techniques/hatched-fill.js'
import { PATH_VERTEX_FLOATS, pathStrokes } from '../../techniques/path-line.js'
import { outlinePasses, preparedStrokes } from './prepare.js'
import {
  resolveStyle,
  type PencilLayer,
  type ResolvedLayer,
  type ResolvedStyle,
} from './style.js'

const params = brushSources.pencil.params

/** A drawing progress as the end of a stroke time window: nothing is drawn at 0 and everything,
 * including strokes scheduled just past 1, at 1. Undefined is the start of a fresh drawing. */
function windowEnd(progress: number | undefined) {
  if (progress === undefined || progress <= 0.0001) return -1
  return progress >= 0.9999 ? 2 : progress
}

/** One compiled program and the uniforms the pencil's settings write to. */
type PencilProgram = {
  program: WebGLProgram
  uniform(name: string): WebGLUniformLocation | null
  bindings: {
    layer: PencilLayer
    key: string
    location: WebGLUniformLocation | null
    range: boolean
  }[]
}

/** Pencil settings that become shader uniforms. Layer opacity is applied by the paper pass instead. */
const uniformParams = params
  .filter((param) => param.key !== 'opacity')
  .map((param) => ({
    layer: param.layer,
    key: param.key,
    name: `${param.layer}_${param.key}`,
    range: param.type === 'range',
  }))

const declarations = uniformParams
  .map(({ name, range }) => `uniform ${range ? 'vec2' : 'float'} ${name};`)
  .join('\n')
const strokeShader = `${preludeShader}\n${declarations}\n${brushSources.pencil.source}`
const fragmentShader = `${strokeShader}\n${composeShader}`

export function createPencilPainter({
  gl,
  canvas,
  artwork,
  quad,
  restoreBlend,
}: BrushContext): BrushPainter<ResolvedStyle, PencilLayer> {
  const prepared = preparedStrokes(artwork)
  // Compiled on the first paint: the paper pass, and the programs that draw the strokes.
  let paperProgram: PencilProgram | undefined
  let strokeProgram: PencilProgram | undefined
  let outlineProgram: PencilProgram | undefined
  let outlineStrokes: ReturnType<typeof createOutlineStrokes> | undefined
  let strokeBuffer: ReturnType<typeof createStrokeBuffer> | undefined
  /** What the stroke buffer holds: the drawing it belongs to, and how far it has been drawn. */
  let drawn: { key: string; shading: number; outline: number } | undefined

  function setValues(
    layer: PencilLayer,
    values: ResolvedLayer['values'],
    bindings: PencilProgram['bindings'],
  ) {
    for (const binding of bindings) {
      if (binding.layer !== layer) continue
      const value = values[binding.key]
      if (binding.range) {
        const [min, max] = value as readonly [number, number]
        gl.uniform2f(binding.location, min, max)
      } else gl.uniform1f(binding.location, value as number)
    }
  }
  /** A shading layer's strokes, and in the first pass the outline's, into the buffer that the
   * paper pass then reads. */
  function drawStrokes(
    program: PencilProgram,
    buffer: NonNullable<typeof strokeBuffer>,
    values: ResolvedLayer['values'],
    progress: { shading: number; outline: number },
    shading: boolean,
    outline: ResolvedLayer['values'] | undefined,
    keep: boolean,
  ) {
    const grid = strokeGrid(values)
    // While the drawing only moves forward, add just the strokes drawn since the last frame.
    const key = JSON.stringify([
      canvas.width,
      canvas.height,
      values,
      shading,
      outline,
    ])
    const from =
      keep &&
      drawn?.key === key &&
      progress.shading >= drawn.shading &&
      progress.outline >= drawn.outline
        ? drawn
        : undefined
    buffer.begin(canvas.width, canvas.height, !!from)
    drawn = keep ? { key, ...progress } : undefined
    gl.useProgram(program.program)
    setValues('shading', values, program.bindings)
    gl.uniform1f(program.uniform('uLaneStart'), grid.laneStart)
    gl.uniform1i(program.uniform('uStrokesPerLane'), grid.strokesPerLane)
    gl.uniform1f(program.uniform('uStrokeStart'), grid.strokeStart)
    gl.uniform1f(program.uniform('uCullMargin'), cullMargin(values))
    gl.uniform2f(
      program.uniform('uShadingWindow'),
      windowEnd(from?.shading),
      windowEnd(progress.shading),
    )
    // One instance per lane: two series of strokes, each SECTIONS quads of two triangles.
    if (shading)
      gl.drawArraysInstanced(
        gl.TRIANGLES,
        0,
        2 * grid.strokesPerLane * SECTIONS * 6,
        grid.lanes,
      )
    if (outline && outlineProgram) {
      // The passes are draw settings, so a new count rebuilds the outline's strokes.
      const { searchingLines, firmPasses } = outlinePasses(outline)
      if (
        outlineStrokes?.searchingLines !== searchingLines ||
        outlineStrokes.firmPasses !== firmPasses
      ) {
        if (outlineStrokes) {
          gl.deleteVertexArray(outlineStrokes.vertexArray)
          gl.deleteBuffer(outlineStrokes.buffer)
        }
        outlineStrokes = createOutlineStrokes(searchingLines, firmPasses)
      }
      gl.useProgram(outlineProgram.program)
      setValues('shading', values, outlineProgram.bindings)
      setValues('outline', outline, outlineProgram.bindings)
      gl.uniform2f(
        outlineProgram.uniform('uOutlineWindow'),
        windowEnd(from?.outline),
        windowEnd(progress.outline),
      )
      gl.bindVertexArray(outlineStrokes.vertexArray)
      gl.drawArrays(gl.TRIANGLES, 0, outlineStrokes.count)
      gl.bindVertexArray(quad)
    }
    buffer.end(restoreBlend)
    gl.useProgram(paperProgram!.program)
    gl.viewport(0, 0, canvas.width, canvas.height)
  }
  /** Vertex data for the outline strokes, built once from the artwork's paths. */
  function createOutlineStrokes(searchingLines: number, firmPasses: number) {
    const ready = prepared?.outline
    const data =
      ready?.searchingLines === searchingLines &&
      ready.firmPasses === firmPasses
        ? ready.data
        : pathStrokes(artwork.paths, searchingLines, firmPasses)
    const array = gl.createVertexArray()
    gl.bindVertexArray(array)
    const buffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW)
    const stride = PATH_VERTEX_FLOATS * 4
    for (const [location, size, offset] of [
      [2, 2, 0],
      [3, 2, 2],
      [4, 4, 4],
      [5, 4, 8],
      [6, 1, 12],
    ]) {
      gl.enableVertexAttribArray(location)
      gl.vertexAttribPointer(
        location,
        size,
        gl.FLOAT,
        false,
        stride,
        offset * 4,
      )
    }
    gl.bindVertexArray(quad)
    return {
      vertexArray: array,
      buffer,
      searchingLines,
      firmPasses,
      count: data.length / PATH_VERTEX_FLOATS,
    }
  }
  function shader(type: GLenum, source: string) {
    const shader = gl.createShader(type)!
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    return shader
  }
  /** The paper pass, or the program that draws the hatching strokes or the outline strokes. */
  function createProgram(strokes?: 'hatching' | 'outline'): PencilProgram {
    const prefix = '#version 300 es\n'
    const program = gl.createProgram()
    const shaders = strokes
      ? [
          shader(
            gl.VERTEX_SHADER,
            `${prefix}#define ${strokes === 'outline' ? 'GRAPHITE_STROKE_PATH_VERTEX' : 'GRAPHITE_STROKE_VERTEX'}\n${strokeShader}`,
          ),
          shader(
            gl.FRAGMENT_SHADER,
            `${prefix}#define GRAPHITE_STROKE_FRAGMENT\n${strokeShader}`,
          ),
        ]
      : [
          shader(gl.VERTEX_SHADER, prefix + vertexShader),
          shader(gl.FRAGMENT_SHADER, prefix + fragmentShader),
        ]
    for (const shader of shaders) gl.attachShader(program, shader)
    gl.bindAttribLocation(program, 0, 'position')
    gl.bindAttribLocation(program, 1, 'uv')
    gl.bindAttribLocation(program, 2, 'aCentre')
    gl.bindAttribLocation(program, 3, 'aNormal')
    gl.bindAttribLocation(program, 4, 'aStroke')
    gl.bindAttribLocation(program, 5, 'aFaint')
    gl.bindAttribLocation(program, 6, 'aDown')
    gl.linkProgram(program)
    const linked = gl.getProgramParameter(program, gl.LINK_STATUS)
    const log = linked
      ? ''
      : shaders
          .map((shader) => gl.getShaderInfoLog(shader))
          .concat(gl.getProgramInfoLog(program))
          .filter(Boolean)
          .join('\n')
    for (const shader of shaders) gl.deleteShader(shader)
    if (!linked) {
      gl.deleteProgram(program)
      throw new Error(`Graphite shader compilation failed\n${log}`.trim())
    }
    const uniform = (name: string) => gl.getUniformLocation(program, name)
    gl.useProgram(program)
    // Texture units: the field at 0; the stroke buffer at 1 and its farness map at 2.
    ;['uField', 'uStrokes', 'uFar'].forEach((name, unit) =>
      gl.uniform1i(uniform(name), unit),
    )
    gl.uniform2f(uniform('uFieldSize'), FIELD_WIDTH, FIELD_HEIGHT)
    const bindings = uniformParams.map(({ layer, key, name, range }) => ({
      layer,
      key,
      range,
      location: uniform(name),
    }))
    return { program, uniform, bindings }
  }

  return {
    dispose() {
      for (const program of [paperProgram, strokeProgram, outlineProgram])
        if (program) gl.deleteProgram(program.program)
      paperProgram = strokeProgram = outlineProgram = undefined
      strokeBuffer?.dispose()
      if (outlineStrokes) {
        gl.deleteVertexArray(outlineStrokes.vertexArray)
        gl.deleteBuffer(outlineStrokes.buffer)
      }
    },
    paint(style, [r, g, b], progress) {
      if (!paperProgram || !strokeProgram || !outlineProgram) {
        paperProgram ??= createProgram()
        strokeBuffer ??= createStrokeBuffer(
          gl,
          1,
          prepared?.farness ?? farness(artwork.field),
        )
        strokeProgram ??= createProgram('hatching')
        outlineProgram ??= createProgram('outline')
      }
      const { uniform, bindings } = paperProgram
      const hatching = strokeProgram,
        buffer = strokeBuffer!
      gl.useProgram(paperProgram.program)
      gl.uniform3f(uniform('uColor'), r, g, b)
      setValues('outline', style.outline.values, bindings)
      // One pass per shading layer; the outline is drawn with the first. Blending adds each pass
      // as graphite on top of the last: coverage 1 - (1 - a)(1 - b).
      const layers = style.shading.length ? style.shading : [undefined]
      // The stroke buffer can carry over between frames only when one layer uses it.
      const strokeLayers = layers.filter((layer) => layer?.enabled).length
      layers.forEach((layer, index) => {
        // The outline strokes are drawn in the first shading layer's pass, even when that layer is
        // off. The outline's own settings set its look: it reads none of the shading's.
        const strokeOutline = index === 0 && style.outline.enabled
        const pencil =
          layer?.values ??
          (strokeOutline
            ? resolveStyle({ paper: style.paper }).shading[0].values
            : undefined)
        gl.uniform1f(
          uniform('uOutlineOpacity'),
          index === 0 && style.outline.enabled ? style.outline.opacity : 0,
        )
        gl.uniform1f(
          uniform('uShadingOpacity'),
          layer?.enabled ? layer.opacity : 0,
        )
        if (pencil) setValues('shading', pencil, bindings)
        if ((layer?.enabled || strokeOutline) && pencil)
          drawStrokes(
            hatching,
            buffer,
            pencil,
            progress,
            !!layer?.enabled,
            strokeOutline ? style.outline.values : undefined,
            strokeLayers <= 1,
          )
        gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0)
      })
    },
  }
}
