import { FIELD_WIDTH, FIELD_HEIGHT } from './constants.js'

/** The order the fill appears in while the drawing animates: overlapping passes `passLength`
 * long, in bands `bandWidth` wide, with ends jittered by up to `endpointJitter`. Field units. */
export type FillRevealOptions = {
  passLength: number
  bandWidth: number
  endpointJitter: number
}
export const defaultFillReveal: Readonly<FillRevealOptions> = Object.freeze({
  passLength: 130,
  bandWidth: 12,
  endpointJitter: 20,
})

// Visibility only: short overlapping areas are filled in alternating pencil passes.
export function buildFillOrder(
  coverage: Uint8Array,
  options: Partial<FillRevealOptions> = {},
): Uint8Array {
  const { passLength, bandWidth, endpointJitter } = {
    ...defaultFillReveal,
    ...options,
  }
  if (
    !Number.isFinite(passLength) ||
    passLength < 16 ||
    passLength > 2000 ||
    !Number.isInteger(bandWidth) ||
    bandWidth < 1 ||
    bandWidth > 320 ||
    !Number.isFinite(endpointJitter) ||
    endpointJitter < 0 ||
    endpointJitter > passLength / 2
  )
    throw new RangeError('Invalid fill reveal options')
  const lanes = Math.ceil((FIELD_WIDTH + FIELD_HEIGHT) / 3.6) + 1
  const low = new Float32Array(lanes).fill(Infinity)
  const high = new Float32Array(lanes).fill(-Infinity)
  for (let i = 0; i < coverage.length; i++) {
    if (coverage[i] <= 2) continue
    const x = i % FIELD_WIDTH,
      y = Math.floor(i / FIELD_WIDTH)
    const lane = Math.floor((x + y) / 3.6)
    low[lane] = Math.min(low[lane], x - y)
    high[lane] = Math.max(high[lane], x - y)
  }
  const active = [...low.keys()].filter((i) => Number.isFinite(low[i]))
  if (!active.length) throw new Error('Artwork has no graphite tone')
  type Pass = { start: number; end: number; time: number; reverse: boolean }
  const passes: Pass[][] = Array.from({ length: lanes }, () => [])
  let time = 0
  for (let band = 0; band < active.length; band += bandWidth) {
    const group = active.slice(band, band + bandWidth)
    const start = Math.min(...group.map((i) => low[i])) - (endpointJitter + 4)
    const end = Math.max(...group.map((i) => high[i])) + (endpointJitter + 4)
    const chunks = Math.ceil((end - start) / passLength)
    for (let step = 0; step < chunks; step++) {
      const chunk = (band / bandWidth) % 2 ? chunks - 1 - step : step
      const ordered = step % 2 ? [...group].reverse() : group
      for (const lane of ordered) {
        const shift = Math.sin(lane * 2.17) * endpointJitter
        const a = Math.max(low[lane], start + chunk * passLength + shift)
        const b = Math.min(high[lane], start + (chunk + 1) * passLength + shift)
        if (b < a) continue
        passes[lane].push({ start: a, end: b, time, reverse: lane % 2 === 1 })
        time += Math.max(1, b - a)
      }
    }
  }
  const result = new Uint8Array(FIELD_WIDTH * FIELD_HEIGHT).fill(255)
  for (let i = 0; i < result.length; i++) {
    const x = i % FIELD_WIDTH,
      y = Math.floor(i / FIELD_WIDTH)
    const lane = Math.floor((x + y) / 3.6)
    const position = Math.max(low[lane], Math.min(high[lane], x - y))
    const pass = passes[lane].find(
      (p) => position >= p.start && position <= p.end,
    )
    if (!pass) continue
    const along = pass.reverse ? pass.end - position : position - pass.start
    result[i] = Math.round((255 * (pass.time + along)) / time)
  }
  return result
}
