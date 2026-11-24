// The paper's tooth, shared by the pencil brush and smudges. A JavaScript port of
// `toothNoise` and `paperHeight` in brushes/pencil.glsl (round tooth only); keep them alike.

/** Tooth size in field units for the `paper` setting, 0 (smooth) to 1 (rough). */
export function grainSize(paper: number) {
  return 2 ** (2 * (paper - 0.5))
}

const fract = (x: number) => x - Math.floor(x)
const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/** The prelude's `hash`. */
function hash(x: number, y: number) {
  let px = fract(x * 0.1031)
  let py = fract(y * 0.11369)
  const d = px * (px + 19.19) + py * (py + 37.37)
  px += d
  py += d
  return fract((px + py) * px * py)
}

/** Gradient noise, about 0-1. */
function toothNoise(x: number, y: number) {
  const ix = Math.floor(x),
    iy = Math.floor(y)
  const fx = x - ix,
    fy = y - iy
  const fade = (f: number) => f * f * f * (f * (f * 6 - 15) + 10)
  const corner = (cx: number, cy: number) => {
    const angle = hash(ix + cx, iy + cy) * 6.2832
    return Math.cos(angle) * (fx - cx) + Math.sin(angle) * (fy - cy)
  }
  const ux = fade(fx),
    uy = fade(fy)
  const bottom = corner(0, 0) + (corner(1, 0) - corner(0, 0)) * ux
  const top = corner(0, 1) + (corner(1, 1) - corner(0, 1)) * ux
  return 0.5 + 0.7 * (bottom + (top - bottom) * uy)
}

/** Paper height at a position in field units, 0 (valley) to 1 (peak). `pixel` is the size of one
 * output pixel in field units: the tooth never gets finer than about two pixels. */
export function paperHeight(x: number, y: number, size: number, pixel = 1) {
  size = Math.max(size, 2 * pixel)
  let height = 0,
    weight = 0,
    amplitude = 1,
    scale = 1
  for (let octave = 0; octave < 5; octave++) {
    const resolved = 1 - smoothstep(0.5, 0.7, (pixel * scale) / size)
    const turn = octave * 1.17
    const qx = (x / size) * scale,
      qy = (y / size) * scale
    const rx = Math.cos(turn) * qx - Math.sin(turn) * qy
    const ry = Math.sin(turn) * qx + Math.cos(turn) * qy
    height +=
      amplitude * resolved * toothNoise(rx + octave * 17.3, ry + octave * 17.3)
    weight += amplitude * resolved
    amplitude *= 0.6
    scale *= 2.03
  }
  return smoothstep(0.2, 0.8, height / Math.max(weight, 1e-4))
}
