// Hatched fill: lanes of strokes across the artwork's fill. Works out which strokes can reach the
// artwork; the brush's shader draws them.
import { FIELD_HEIGHT, FIELD_WIDTH } from '../core/constants.js'

/** Keep equal to the brush's constants of the same names. */
const STROKE_LENGTH = 22.7225
const STROKE_TILT = 0.0227
/** Points sampled along each stroke's ribbon; keep equal to SECTIONS in the brush. */
export const SECTIONS = 8

type Values = Record<string, number | readonly [number, number]>

/** How far a stroke's graphite can reach from its lane's place: the hand's stray plus the ribbon. */
function strayReach(values: Values) {
  const value = (key: string) => values[key] as number
  const spacing = value('strokeSpacing')
  return (
    9 * value('wander') +
    1.5 * value('tremor') +
    (0.5 * value('laneJitter') + 0.6 * value('grouping')) * spacing +
    STROKE_TILT * STROKE_LENGTH * 0.5 +
    value('strokeWidth') * 1.25 * 2.5 +
    spacing +
    1
  )
}

/** The lanes and strokes the hand draws so that every point of the field is covered. */
export function strokeGrid(values: Values) {
  const value = (key: string) => values[key] as number
  const spacing = value('strokeSpacing')
  const arc = value('handArc')
  const angle = (value('angle') * Math.PI) / 180
  const direction = [Math.cos(angle), -Math.sin(angle)]
  const normal = [-direction[1], direction[0]]
  const middle =
    (FIELD_WIDTH / 2) * direction[0] + (FIELD_HEIGHT / 2) * direction[1]
  // Hatching coordinates of points around the field's border, as in hatchAt.
  let acrossMin = Infinity,
    acrossMax = -Infinity,
    alongMin = Infinity,
    alongMax = -Infinity
  const steps = 64
  for (let i = 0; i <= steps; i++)
    for (const [x, y] of [
      [(FIELD_WIDTH * i) / steps, 0],
      [(FIELD_WIDTH * i) / steps, FIELD_HEIGHT],
      [0, (FIELD_HEIGHT * i) / steps],
      [FIELD_WIDTH, (FIELD_HEIGHT * i) / steps],
    ]) {
      const along = x * direction[0] + y * direction[1]
      const across =
        x * normal[0] + y * normal[1] + 0.5 * arc * (along - middle) ** 2
      acrossMin = Math.min(acrossMin, across)
      acrossMax = Math.max(acrossMax, across)
      alongMin = Math.min(alongMin, along)
      alongMax = Math.max(alongMax, along)
    }
  const reach = strayReach(values)
  const laneStart = Math.floor((acrossMin - reach) / spacing) - 1
  const laneEnd = Math.ceil((acrossMax + reach) / spacing) + 1
  const strokeStart = Math.floor(alongMin / STROKE_LENGTH) - 1
  const strokeEnd = Math.ceil(alongMax / STROKE_LENGTH) + 2
  const lanes = laneEnd - laneStart
  const strokesPerLane = strokeEnd - strokeStart
  return {
    laneStart,
    lanes,
    strokeStart,
    strokesPerLane,
    /** Two series of strokes per lane. */
    strokes: lanes * 2 * strokesPerLane,
  }
}

/** How far each field point is from the shape's near zone, in field units up to 255. The prepared
 * field only measures distances up to 16, so a stroke far outside the shape can't tell it is far.
 * With this map the hand skips such strokes. 0 within 15 units of the shape. */
export function farness(field: Uint8Array) {
  const w = FIELD_WIDTH,
    h = FIELD_HEIGHT
  const out = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++)
    out[i] = (field[i * 4 + 1] / 255 - 0.5) * 32 > -15 ? 0 : 1e4
  // Two-pass chamfer distance, as in prepare.ts.
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (x) out[i] = Math.min(out[i], out[i - 1] + 1)
      if (y) out[i] = Math.min(out[i], out[i - w] + 1)
      if (x && y) out[i] = Math.min(out[i], out[i - w - 1] + Math.SQRT2)
      if (x + 1 < w && y) out[i] = Math.min(out[i], out[i - w + 1] + Math.SQRT2)
    }
  for (let y = h - 1; y >= 0; y--)
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x
      if (x + 1 < w) out[i] = Math.min(out[i], out[i + 1] + 1)
      if (y + 1 < h) out[i] = Math.min(out[i], out[i + w] + 1)
      if (x + 1 < w && y + 1 < h)
        out[i] = Math.min(out[i], out[i + w + 1] + Math.SQRT2)
      if (x && y + 1 < h) out[i] = Math.min(out[i], out[i + w - 1] + Math.SQRT2)
    }
  // Rounded down, so the map never says a point is further than it is.
  return Uint8Array.from(out, (d) => Math.min(255, Math.floor(d)))
}

/** The margin a stroke's centre must keep from the shape's near zone to leave no graphite. */
export function cullMargin(values: Values) {
  const endReach = Math.max(
    0,
    (values.endReach as readonly [number, number])[1],
  )
  // A stroke leaves graphite only within the smoothing (1.3) of the shape, after its end reach
  // (the ragged cut-off only pulls ends back). Its centre strays and its ribbon reaches
  // strayReach, and the hand samples it every half stroke. Farness starts 15 from the shape and
  // the chamfer distance can read up to 8% long.
  const reach = strayReach(values) + endReach + 1.3 + STROKE_LENGTH / 4
  return (reach - 15) / 0.92 + 1
}
