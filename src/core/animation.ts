import { brushDefinition, type Brush } from './brush.js'

/** A stroke's interval within its animation phase. */
export type StrokeTiming = Readonly<{
  /** When the stroke starts, measured from the beginning of the phase. */
  start: number
  /** How long the stroke takes, in the same units as the start time. */
  duration: number
}>

/** Seconds; the host supplies the clock and owns scheduling, pause and replay. */
export type DrawingTiming<Layer extends string = string> = {
  /** How long the construction guides take before the first layer. Defaults to 0.42. */
  guides?: number
  /** How long each layer takes. Defaults come from the brush. */
  layers?: Partial<Record<Layer, number>>
}
/** A brush drawing schedule with durations and elapsed time in seconds. */
export type DrawingTimeline<Layer extends string = string> = Readonly<{
  /** Seconds the guides take. */
  guides: number
  /** When each layer starts and how long it takes. Layers draw one after another, in the brush's
   * order. */
  layers: Readonly<Record<Layer, StrokeTiming>>
  /** Total seconds for the guides and every layer. */
  duration: number
  /** Drawing progress per layer at a host-supplied elapsed time, in seconds. Pass it to
   * `render({ progress })`. */
  at(seconds: number): Record<Layer, number>
}>

/**
 * Creates a timeline for optional construction guides followed by each brush
 * layer in order. Call `timeline.at(elapsedSeconds)` for renderer progress.
 */
export function createDrawingTimeline<Layer extends string>(
  brush: Brush<unknown, Layer>,
  options: DrawingTiming<Layer> = {},
): DrawingTimeline<Layer> {
  const { durations } = brushDefinition(brush)
  for (const key of Object.keys(options.layers ?? {}))
    if (!brush.layers.includes(key as Layer))
      throw new TypeError(`${key} is not a ${brush.name} layer`)
  const guides = options.guides ?? 0.42
  const check = (value: number) => {
    if (!Number.isFinite(value) || value < 0)
      throw new RangeError(
        'Drawing durations must be finite non-negative seconds',
      )
    return value
  }
  let cursor = check(guides)
  const layers = Object.fromEntries(
    brush.layers.map((layer) => {
      const duration = check(options.layers?.[layer] ?? durations[layer])
      const slot = Object.freeze({ start: cursor, duration })
      cursor += duration
      return [layer, slot]
    }),
  ) as Record<Layer, StrokeTiming>
  const progress = (time: number, { start, duration }: StrokeTiming) =>
    duration === 0
      ? Number(time >= start)
      : Math.max(0, Math.min(1, (time - start) / duration))
  return Object.freeze({
    guides,
    layers: Object.freeze(layers),
    duration: cursor,
    at(seconds: number) {
      if (!Number.isFinite(seconds))
        throw new RangeError('Drawing time must be finite')
      return Object.fromEntries(
        brush.layers.map((layer) => [layer, progress(seconds, layers[layer])]),
      ) as Record<Layer, number>
    },
  })
}

/**
 * Divides a phase among sequential strokes.
 *
 * @param strokes - A count for equal slots, or positive weights for relative durations.
 * @param duration - The full phase duration. Defaults to 1 for normalized timing.
 * @returns One start and duration pair per stroke.
 */
export function createStrokeSequence(
  strokes: number | readonly number[],
  duration = 1,
): readonly StrokeTiming[] {
  if (!Number.isFinite(duration) || duration < 0)
    throw new RangeError('Phase duration must be finite non-negative seconds')
  if (
    typeof strokes === 'number' &&
    (!Number.isInteger(strokes) || strokes < 0 || strokes > 4096)
  )
    throw new RangeError('Stroke count must be an integer from 0 to 4096')
  const weights =
    typeof strokes === 'number' ? Array<number>(strokes).fill(1) : strokes
  if (
    weights.length > 4096 ||
    !weights.every((w) => Number.isFinite(w) && w > 0)
  )
    throw new RangeError(
      'Stroke weights must be finite and positive, with at most 4096 entries',
    )
  const max = Math.max(0, ...weights)
  const scaled = weights.map((w) => w / max)
  const total = scaled.reduce((sum, w) => sum + w, 0)
  let cursor = 0
  return Object.freeze(
    scaled.map((weight, index) => {
      const length =
        index === scaled.length - 1
          ? duration - cursor
          : (weight / total) * duration
      const slot = Object.freeze({ start: cursor, duration: length })
      cursor += length
      return slot
    }),
  )
}
