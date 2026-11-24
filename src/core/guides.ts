import { createStrokeSequence, type StrokeTiming } from './animation.js'
import { FIELD_WIDTH, FIELD_HEIGHT } from './constants.js'
import type { PreparedArtwork } from './prepare.js'

/** Default guide roughness and extension beyond the endpoints. */
export const defaultGuides = Object.freeze({ roughness: 0.5, overshoot: 90 })

/** A custom straight guide in artwork field coordinates. */
export type GuideLine = {
  /** Unique identifier for this guide. */
  id: string
  /** Starting point as [x, y]. */
  from: readonly [number, number]
  /** Ending point as [x, y]. */
  to: readonly [number, number]
}
/** Options for a construction-guide overlay. */
export type GuideOptions = {
  /** How far the line strays, from 0 (straight) to 1. Defaults to 0.5. */
  roughness?: number
  /** How far to extend each end in field units. Defaults to 90. */
  overshoot?: number
  /** Use these lines in place of guides based on the artwork bounds and axes. */
  lines?: readonly GuideLine[]
}
export type GeneratedGuides = {
  /** SVG view box in the same coordinate space as the drawing. */
  viewBox: readonly [number, number, number, number]
  /** Path data and start/duration fractions within the guides phase. */
  paths: ({
    id: string
    /** SVG path data for this guide. */
    d: string
  } & StrokeTiming)[]
}

function defaultLines({
  x,
  y,
  width,
  height,
}: PreparedArtwork['bounds']): GuideLine[] {
  if (width === 0) return [{ id: 'y-axis', from: [x, y], to: [x, y + height] }]
  if (height === 0) return [{ id: 'x-axis', from: [x, y], to: [x + width, y] }]
  return [
    { id: 'top', from: [x, y], to: [x + width, y] },
    { id: 'bottom', from: [x, y + height], to: [x + width, y + height] },
    { id: 'left', from: [x, y], to: [x, y + height] },
    { id: 'right', from: [x + width, y], to: [x + width, y + height] },
    {
      id: 'x-axis',
      from: [x, y + height / 2],
      to: [x + width, y + height / 2],
    },
    { id: 'y-axis', from: [x + width / 2, y], to: [x + width / 2, y + height] },
  ]
}

/**
 * Generates guide paths in the drawing's coordinate space. Render them in an
 * SVG overlay and choose the stroke style and timing in your application.
 */
export function generateGuides(
  artwork: Pick<PreparedArtwork, 'bounds'>,
  {
    roughness = defaultGuides.roughness,
    overshoot = defaultGuides.overshoot,
    lines,
  }: GuideOptions = {},
): GeneratedGuides {
  const { x, y, width, height } = artwork.bounds
  if (
    ![x, y, width, height, roughness, overshoot].every(Number.isFinite) ||
    width < 0 ||
    height < 0 ||
    (width === 0 && height === 0) ||
    roughness < 0 ||
    roughness > 1 ||
    overshoot < 0
  )
    throw new RangeError(
      'Guide bounds must be finite with at least one positive dimension, roughness 0-1 and overshoot at least 0',
    )
  const paths: GeneratedGuides['paths'] = []
  function line(
    id: GeneratedGuides['paths'][number]['id'],
    ax: number,
    ay: number,
    bx: number,
    by: number,
  ) {
    const index = paths.length + 1
    const dx = bx - ax,
      dy = by - ay,
      length = Math.hypot(dx, dy)
    const nx = -dy / length,
      ny = dx / length
    const drift = (phase: number) =>
      Math.sin(index * 7.13 + phase) * roughness * 4
    const a = drift(0),
      b = drift(2),
      c = drift(4),
      d = drift(6)
    paths.push({
      start: 0,
      duration: 0,
      id,
      d: `M${ax + nx * a} ${ay + ny * a} C${ax + dx / 3 + nx * b} ${ay + dy / 3 + ny * b} ${ax + (dx * 2) / 3 + nx * c} ${ay + (dy * 2) / 3 + ny * c} ${bx + nx * d} ${by + ny * d}`,
    })
  }
  const definitions = lines ?? defaultLines(artwork.bounds)
  const slots = createStrokeSequence(definitions.length)
  const ids = new Set<string>()
  for (const definition of definitions) {
    const { id, from, to } = definition
    if (
      !id ||
      ids.has(id) ||
      from.length !== 2 ||
      to.length !== 2 ||
      ![...from, ...to].every(Number.isFinite)
    )
      throw new TypeError('Guides require unique IDs and finite endpoints')
    ids.add(id)
    const dx = to[0] - from[0],
      dy = to[1] - from[1],
      length = Math.hypot(dx, dy)
    if (!length || !Number.isFinite(length))
      throw new RangeError('Guide lines must have finite positive length')
    line(
      id,
      from[0] - (dx / length) * overshoot,
      from[1] - (dy / length) * overshoot,
      to[0] + (dx / length) * overshoot,
      to[1] + (dy / length) * overshoot,
    )
  }
  return {
    viewBox: [0, 0, FIELD_WIDTH, FIELD_HEIGHT],
    paths: paths.map((path, index) => ({ ...path, ...slots[index] })),
  }
}
