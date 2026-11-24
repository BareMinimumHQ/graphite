import { defaultColor, FIELD_HEIGHT, FIELD_WIDTH } from './constants.js'
import type { PreparedArtwork } from './prepare.js'
import { brushDefinition, type Brush, type BrushPainter } from './brush.js'

/** The artwork, brush and initial backing size for one drawing. */
export type RendererOptions<Style = unknown, Layer extends string = string> = {
  /** Reusable artwork returned by prepareSvg or prepareRaster. */
  artwork: PreparedArtwork
  /** The brush that draws, such as `pencil` from `@bareminimum/graphite/pencil`. */
  brush: Brush<Style, Layer>
  /** Canvas backing width in whole pixels from 1 to 8192. Defaults to 975. */
  width?: number
  /** Canvas backing height in whole pixels from 1 to 8192. Defaults to 750. */
  height?: number
}
/** Options for a single draw. Omitted settings use the brush defaults. */
export type RenderOptions<Style = unknown, Layer extends string = string> = {
  /** Opaque CSS colour for all layers. Defaults to `defaultColor`. */
  color?: string
  /** The brush's settings. Partial settings resolve against the brush's defaults on every call. */
  style?: Style
  /** How far each layer has drawn, 0-1. A layer left out is complete (1). */
  progress?: Partial<Record<Layer, number>>
}
/** Controls drawing and GPU resources for one canvas. */
export type GraphiteRenderer<Style = unknown, Layer extends string = string> = {
  /** Draws once with the given colour, style and progress. */
  render(options?: RenderOptions<Style, Layer>): void
  /** Sets the canvas backing size in pixels. Call `render()` to redraw at that size. */
  resize(width: number, height: number): void
  /** Releases GPU resources. A standalone renderer also releases its context. Idempotent. */
  dispose(): void
}

/** Shares a WebGL context among drawings with separate Canvas 2D targets. */
export type GraphiteRenderingSession = {
  /** Creates a drawing in a dedicated 2D output canvas. */
  createDrawing<Style, Layer extends string>(
    canvas: HTMLCanvasElement,
    options: RendererOptions<Style, Layer>,
  ): GraphiteRenderer<Style, Layer>
  /** Releases all drawings and their shared WebGL context. Idempotent. */
  dispose(): void
}

function validateSize(width: number, height: number) {
  if (
    ![width, height].every(
      (value) => Number.isInteger(value) && value > 0 && value <= 8192,
    )
  )
    throw new RangeError('Output dimensions must be integers from 1 to 8192')
}

/** sRGB byte to linear, as the shader converts back to sRGB on output. */
function linear(value: number) {
  const c = value / 255
  return c < 0.04045
    ? c * 0.0773993808
    : (c * 0.9478672986 + 0.0521327014) ** 2.4
}

/** Resolves a canvas fill colour to sRGB bytes. */
function createColorParser() {
  let probe: CanvasRenderingContext2D | null | undefined
  let last:
    { color: string; rgb: readonly [number, number, number] } | undefined
  return (color: string) => {
    if (last?.color === color) return last.rgb
    probe ??= document
      .createElement('canvas')
      .getContext('2d', { willReadFrequently: true })
    if (!probe) throw new Error('Canvas colour parsing is unavailable')
    // An unresolvable fillStyle leaves the previous value in place.
    probe.fillStyle = '#000000'
    probe.fillStyle = color
    if (probe.fillStyle === '#000000') {
      probe.fillStyle = '#ffffff'
      probe.fillStyle = color
      if (probe.fillStyle === '#ffffff')
        throw new TypeError(
          `"${color}" is not a CSS colour that resolves on a canvas`,
        )
    }
    probe.clearRect(0, 0, 1, 1)
    probe.fillRect(0, 0, 1, 1)
    const [r, g, b, a] = probe.getImageData(0, 0, 1, 1).data
    // getImageData returns unpremultiplied values; a fully transparent colour has no hue.
    const rgb = (a ? [r, g, b] : [0, 0, 0]) as [number, number, number]
    last = { color, rgb }
    return rgb
  }
}

/**
 * Creates a renderer for one dedicated WebGL canvas.
 *
 * @param canvas - A canvas that has no incompatible rendering context.
 * @param options - The prepared artwork, brush and optional backing dimensions.
 * @returns A renderer that draws when you call its `render()` method.
 * @throws If the size or artwork is invalid, or WebGL 2 cannot be initialized.
 *
 * Dispose the renderer when its canvas leaves the page.
 */
export function createRenderer<Style, Layer extends string>(
  canvas: HTMLCanvasElement,
  options: RendererOptions<Style, Layer>,
): GraphiteRenderer<Style, Layer> {
  const session = createSession(canvas)
  try {
    const drawing = session.createDrawing(options)
    return { ...drawing, dispose: session.dispose }
  } catch (error) {
    session.dispose()
    throw error
  }
}

/**
 * Creates a session that shares one private WebGL canvas across multiple drawings.
 *
 * Each `createDrawing()` call needs a dedicated Canvas 2D output target.
 * WebGL opens when the first drawing is created. Dispose the session when finished.
 * If the context is lost, the session disposes its drawings before calling `onContextLost`.
 */
export function createRenderingSession({
  onContextLost,
}: {
  /** Called after the session has released its resources. */
  onContextLost?: () => void
} = {}): GraphiteRenderingSession {
  const session = createSession(document.createElement('canvas'), onContextLost)
  return {
    createDrawing(canvas, options) {
      return session.createDrawing(options, canvas)
    },
    dispose: session.dispose,
  }
}

function createSession(canvas: HTMLCanvasElement, onContextLost?: () => void) {
  const drawings = new Set<() => void>()
  let gl: WebGL2RenderingContext | undefined
  let disposed = false

  function getContext() {
    if (gl) return gl
    const context = canvas.getContext('webgl2', {
      alpha: true,
      antialias: false,
      premultipliedAlpha: true,
      powerPreference: 'low-power',
    })
    if (!context) throw new Error('WebGL 2 is unavailable')
    gl = context
    canvas.addEventListener('webglcontextlost', lost)
    return context
  }

  function dispose() {
    if (disposed) return
    disposed = true
    if (gl) canvas.removeEventListener('webglcontextlost', lost)
    for (const disposeDrawing of drawings) disposeDrawing()
    gl?.getExtension('WEBGL_lose_context')?.loseContext()
  }

  function lost(event: Event) {
    event.preventDefault()
    dispose()
    onContextLost?.()
  }

  return {
    createDrawing<Style, Layer extends string>(
      options: RendererOptions<Style, Layer>,
      output?: HTMLCanvasElement,
    ): GraphiteRenderer<Style, Layer> {
      if (disposed)
        throw new Error('Graphite session is disposed or its context was lost')
      const drawing = createDrawingRenderer(canvas, getContext, options, output)
      function disposeDrawing() {
        drawings.delete(disposeDrawing)
        drawing.dispose()
      }
      drawings.add(disposeDrawing)
      return { ...drawing, dispose: disposeDrawing }
    },
    dispose,
  }
}

function createDrawingRenderer<Style, Layer extends string>(
  canvas: HTMLCanvasElement,
  getContext: () => WebGL2RenderingContext,
  options: RendererOptions<Style, Layer>,
  output?: HTMLCanvasElement,
): GraphiteRenderer<Style, Layer> {
  const { brush } = options
  const definition = brushDefinition(brush)
  const width = options.width ?? 975,
    height = options.height ?? 750
  validateSize(width, height)
  if (options.artwork.field.length !== FIELD_WIDTH * FIELD_HEIGHT * 4)
    throw new RangeError('Artwork field dimensions do not match this renderer')
  const parseColor = createColorParser()
  const display = output?.getContext('2d')
  if (output && !display) throw new Error('Canvas 2D is unavailable')
  const target = output ?? canvas
  const gl = getContext()
  const field = gl.createTexture()
  const buffers: WebGLBuffer[] = []
  let vertexArray: WebGLVertexArrayObject | null = null
  let painter: BrushPainter<unknown, Layer> | undefined
  let disposed = false
  function dispose() {
    if (disposed) return
    disposed = true
    painter?.dispose()
    painter = undefined
    gl.deleteTexture(field)
    for (const buffer of buffers) gl.deleteBuffer(buffer)
    gl.deleteVertexArray(vertexArray)
  }
  function assertUsable() {
    if (disposed || gl.isContextLost())
      throw new Error('Graphite renderer is disposed or its context was lost')
  }
  /** Uploads the prepared field to texture unit 0. */
  function bindField() {
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, field)
  }
  function uploadField(data: Uint8Array) {
    bindField()
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA8,
      FIELD_WIDTH,
      FIELD_HEIGHT,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      data,
    )
  }
  function restoreBlend() {
    gl.blendFuncSeparate(
      gl.SRC_ALPHA,
      gl.ONE_MINUS_SRC_ALPHA,
      gl.ONE,
      gl.ONE_MINUS_SRC_ALPHA,
    )
  }
  try {
    if (!field) throw new Error('Could not allocate the Graphite field texture')
    // Raw bytes in, raw bytes sampled: no flipping, premultiplying or colour conversion.
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    uploadField(options.artwork.field)
    // Two triangles covering the canvas. uv is y-up; the shader flips it to the field's y-down.
    vertexArray = gl.createVertexArray()
    if (!vertexArray) throw new Error('Could not allocate the Graphite quad')
    gl.bindVertexArray(vertexArray)
    const attribute = (location: number, size: number, data: number[]) => {
      const buffer = gl.createBuffer()
      if (!buffer)
        throw new Error('Could not allocate a Graphite vertex buffer')
      buffers.push(buffer)
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW)
      gl.enableVertexAttribArray(location)
      gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0)
    }
    attribute(0, 3, [-1, 1, 0, 1, 1, 0, -1, -1, 0, 1, -1, 0])
    attribute(1, 2, [0, 1, 1, 1, 0, 0, 1, 0])
    const indices = gl.createBuffer()
    if (!indices)
      throw new Error('Could not allocate the Graphite index buffer')
    buffers.push(indices)
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indices)
    gl.bufferData(
      gl.ELEMENT_ARRAY_BUFFER,
      new Uint16Array([0, 2, 1, 2, 3, 1]),
      gl.STATIC_DRAW,
    )
    target.width = width
    target.height = height
    painter = definition.createPainter({
      gl,
      canvas,
      artwork: options.artwork,
      quad: vertexArray,
      restoreBlend,
    })
  } catch (error) {
    dispose()
    throw error
  }

  return {
    dispose,
    resize(width, height) {
      assertUsable()
      validateSize(width, height)
      target.width = width
      target.height = height
    },
    render(options = {}) {
      assertUsable()
      const style = definition.resolve(options.style)
      const color = options.color ?? defaultColor
      if (typeof color !== 'string' || !color)
        throw new TypeError('color must be a CSS colour string')
      const [r, g, b] = parseColor(color)
      const given: Record<string, unknown> = options.progress ?? {}
      for (const key of Object.keys(given))
        if (!brush.layers.includes(key as Layer))
          throw new TypeError(`progress.${key} is not a ${brush.name} layer`)
      const progress = {} as Record<Layer, number>
      for (const layer of brush.layers) {
        const value = given[layer] ?? 1
        if (
          typeof value !== 'number' ||
          !Number.isFinite(value) ||
          value < 0 ||
          value > 1
        )
          throw new RangeError('Drawing progress must be between 0 and 1')
        progress[layer] = value
      }
      // Each drawing can follow another drawing at a different size and with
      // different GPU resources bound. Restore the state this painter expects.
      if (canvas.width !== target.width) canvas.width = target.width
      if (canvas.height !== target.height) canvas.height = target.height
      if (
        gl.drawingBufferWidth !== target.width ||
        gl.drawingBufferHeight !== target.height
      )
        throw new Error('WebGL could not allocate the requested output size')
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      gl.bindVertexArray(vertexArray)
      bindField()
      gl.enable(gl.BLEND)
      gl.blendEquation(gl.FUNC_ADD)
      restoreBlend()
      gl.clearColor(0, 0, 0, 0)
      gl.viewport(0, 0, canvas.width, canvas.height)
      gl.clear(gl.COLOR_BUFFER_BIT)
      painter!.paint(style, [linear(r), linear(g), linear(b)], progress)
      if (gl.isContextLost()) throw new Error('Graphite context lost')
      if (display) {
        // Copy before another draw overwrites the shared WebGL canvas.
        display.clearRect(0, 0, target.width, target.height)
        display.drawImage(canvas, 0, 0)
      }
    },
  }
}
