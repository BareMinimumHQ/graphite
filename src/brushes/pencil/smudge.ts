import { pathSubpaths } from '../../core/svg-paths.js'
import { grainSize, paperHeight } from '../../surfaces/paper.js'
import { defaultColor } from '../../core/constants.js'

const fract = (value: number) => value - Math.floor(value)
const mix = (a: number, b: number, t: number) => a + (b - a) * t
const smooth = (a: number, b: number, value: number) => {
  const t = Math.max(0, Math.min(1, (value - a) / (b - a)))
  return t * t * (3 - 2 * t)
}
// The value noise from shaders/prelude.glsl, on the CPU.
function hash(x: number, y: number) {
  let a = fract(x * 0.1031),
    b = fract(y * 0.11369)
  const dot = a * (a + 19.19) + b * (b + 37.37)
  a += dot
  b += dot
  return fract((a + b) * a * b)
}
function noise(x: number, y: number) {
  const ix = Math.floor(x),
    iy = Math.floor(y)
  const fx = smooth(0, 1, fract(x)),
    fy = smooth(0, 1, fract(y))
  return mix(
    mix(hash(ix, iy), hash(ix + 1, iy), fx),
    mix(hash(ix, iy + 1), hash(ix + 1, iy + 1), fx),
    fy,
  )
}

/** Input for drawing one experimental graphite smudge. */
export type SmudgeOptions = {
  /** SVG path the hand drags along. */
  path: string
  /** Width of the smear, in path units. */
  size: number
  /** How much graphite is dragged, 0 to 1. Defaults to 0.5. */
  pressure?: number
  /** How feathered the edge is, 0 to 1: higher is wider and softer. Defaults to 0.5. */
  softness?: number
  /** The paper, 0 (smooth) to 1 (rough), as in the pencil brush. Defaults to 0.5. */
  paper?: number
  /** Whole number that varies the smear. Defaults to 0. */
  seed?: number
  /** Six-digit hex colour. Defaults to the package's default colour. */
  color?: string
}

/** Cropped smudge placement within its original frame, in pixels. */
export type SmudgeBounds = {
  /** Left edge of the crop within the original frame. */
  x: number
  /** Top edge of the crop within the original frame. */
  y: number
  /** Cropped canvas width. */
  width: number
  /** Cropped canvas height. */
  height: number
  /** Width before cropping. */
  frameWidth: number
  /** Height before cropping. */
  frameHeight: number
}

// Radial pigment mass is proportional to the integral of opacity * radius.
// Account for the changing core/feather profile as well as the brush's area.
function profileMass(innerStop: number) {
  const stops = [
    [0, 1],
    [innerStop, 0.85],
    [0.7, 0.22],
    [1, 0],
  ]
  let mass = 0
  for (let i = 1; i < stops.length; i++) {
    const [a, alpha] = stops[i - 1],
      [b, endAlpha] = stops[i]
    const slope = (endAlpha - alpha) / (b - a)
    const square = (b * b - a * a) / 2
    mass += alpha * square + slope * ((b ** 3 - a ** 3) / 3 - a * square)
  }
  return mass
}

/**
 * Draws a graphite smudge along SVG path data and crops the canvas to the mark.
 * Use an `OffscreenCanvas` to run this in a worker. This API is experimental.
 *
 * @returns The crop and original frame dimensions for positioning the mark.
 */
export function renderSmudge(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  options: SmudgeOptions,
): SmudgeBounds {
  const {
    path,
    size: width,
    pressure = 0.5,
    softness = 0.5,
    paper = 0.5,
    seed = 0,
    color = defaultColor,
  } = options
  if (!Number.isFinite(width) || width <= 0)
    throw new RangeError('size must be a positive number')
  for (const [name, value] of [
    ['pressure', pressure],
    ['softness', softness],
    ['paper', paper],
  ] as const)
    if (!Number.isFinite(value) || value < 0 || value > 1)
      throw new RangeError(`${name} must be between 0 and 1`)
  if (!Number.isInteger(seed)) throw new RangeError('seed must be an integer')
  if (!/^#[0-9a-f]{6}$/i.test(color))
    throw new TypeError('color must be a six-digit hex colour')
  // Softness widens the contact and progressively feathers its edge.
  const footprintScale = 0.5 + softness * 2.5
  const pigmentDensity = pressure * 0.5
  const featherMultiplier = 2 * footprintScale - 1
  const curves = pathSubpaths(path)
  if (!curves.length) throw new Error('Smudge path has no curves')
  const points = curves.flatMap((curve) => curve.spacedPoints(128))
  if (
    !points.every(
      (point) => Number.isFinite(point.x) && Number.isFinite(point.y),
    )
  )
    throw new Error('Smudge path has invalid coordinates')
  const padding = Math.ceil(width * 3.01 + 8)
  const left = Math.floor(Math.min(...points.map((p) => p.x)) - padding)
  const top = Math.floor(Math.min(...points.map((p) => p.y)) - padding)
  const outputWidth = Math.ceil(
    Math.max(...points.map((p) => p.x)) + padding - left,
  )
  const outputHeight = Math.ceil(
    Math.max(...points.map((p) => p.y)) + padding - top,
  )
  if (outputWidth > 4096 || outputHeight > 4096)
    throw new RangeError('Smudge bounds exceed 4096 pixels')
  canvas.width = outputWidth
  canvas.height = outputHeight
  const bounds: SmudgeBounds = {
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    frameWidth: outputWidth,
    frameHeight: outputHeight,
  }
  if (pressure === 0) {
    canvas.width = canvas.height = 1
    return bounds
  }
  const mask =
    typeof document === 'undefined'
      ? new OffscreenCanvas(outputWidth, outputHeight)
      : Object.assign(document.createElement('canvas'), {
          width: outputWidth,
          height: outputHeight,
        })
  const ctx = mask.getContext('2d', { willReadFrequently: true })!
  curves.forEach((curve, curveIndex) => {
    const count = Math.max(2, Math.ceil(curve.length / 9))
    curve.spacedPoints(count).forEach((point, index) => {
      const pressure = noise(index * 0.18 + seed * 7, curveIndex * 13 + seed)
      const baseRadius = width * (0.48 + pressure * 0.22)
      const coreRadius = baseRadius * footprintScale
      const radius = coreRadius + width * 0.18 * featherMultiplier
      ctx.save()
      ctx.translate(point.x - left, point.y - top)
      ctx.rotate(-0.35 + noise(seed, curveIndex + 3) * 0.4)
      ctx.scale(1, 0.65 + pressure * 0.2)
      const brush = ctx.createRadialGradient(0, 0, 0, 0, 0, radius)
      const innerStop = (coreRadius / radius) * 0.45
      // Calibrate the fixed graphite amount to the existing default impression.
      const referenceCore = baseRadius * 1.5
      const referenceRadius = referenceCore + width * 0.18 * 2
      const referenceOpacity =
        (0.14 + pressure * 0.13) * (referenceCore / referenceRadius) ** 2
      const pigmentMass =
        referenceOpacity *
        referenceRadius ** 2 *
        profileMass((referenceCore / referenceRadius) * 0.45)
      const opacity = Math.min(
        1,
        pigmentMass / (radius ** 2 * profileMass(innerStop)),
      )
      brush.addColorStop(0, `rgb(0 0 0 / ${opacity})`)
      brush.addColorStop(innerStop, `rgb(0 0 0 / ${opacity * 0.85})`)
      brush.addColorStop(0.7, `rgb(0 0 0 / ${opacity * 0.22})`)
      brush.addColorStop(1, 'transparent')
      ctx.fillStyle = brush
      ctx.fillRect(-radius, -radius, radius * 2, radius * 2)
      ctx.restore()
    })
  })
  const coverage = ctx.getImageData(0, 0, outputWidth, outputHeight).data
  const tooth = grainSize(paper)
  const output = canvas.getContext('2d') as
    CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
  const pixels = output.createImageData(outputWidth, outputHeight)
  const rgb = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16))
  for (let y = 0; y < outputHeight; y++)
    for (let x = 0; x < outputWidth; x++) {
      const i = (y * outputWidth + x) * 4
      const contact = coverage[i + 3] / 255
      if (contact === 0) continue
      const cloud = noise(x * 0.025 + seed * 11, y * 0.029 + seed * 3)
      const streak = noise(
        (x + y * 0.32) * 0.018 + seed,
        (y - x * 0.2) * 0.15 + seed * 5,
      )
      const peak = paperHeight(x + seed * 31, y + seed * 17, tooth)
      // Graphite rests on the paper tooth; mottling and rubbing streaks disturb a continuous deposit.
      const pigment =
        contact *
        pigmentDensity *
        (0.45 + cloud * 1.15) *
        (0.82 + streak * 0.32) *
        // Same mean and spread as the grain image this replaced.
        (0.683 + peak * 0.42)
      pixels.data[i] = rgb[0]
      pixels.data[i + 1] = rgb[1]
      pixels.data[i + 2] = rgb[2]
      pixels.data[i + 3] = Math.round(Math.min(1, pigment) * 255)
    }
  // Crop only fully transparent pixels; keep every faint graphite edge plus a
  // two-pixel guard. The frame metadata lets hosts preserve existing placement.
  let minX = outputWidth,
    minY = outputHeight,
    maxX = -1,
    maxY = -1
  for (let y = 0; y < outputHeight; y++)
    for (let x = 0; x < outputWidth; x++)
      if (pixels.data[(y * outputWidth + x) * 4 + 3] !== 0) {
        minX = Math.min(minX, x)
        minY = Math.min(minY, y)
        maxX = Math.max(maxX, x)
        maxY = Math.max(maxY, y)
      }
  if (maxX >= 0) {
    bounds.x = Math.max(0, minX - 2)
    bounds.y = Math.max(0, minY - 2)
    bounds.width = Math.min(outputWidth, maxX + 3) - bounds.x
    bounds.height = Math.min(outputHeight, maxY + 3) - bounds.y
  }
  canvas.width = bounds.width
  canvas.height = bounds.height
  output.putImageData(pixels, -bounds.x, -bounds.y)
  return bounds
}
