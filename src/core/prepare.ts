import { buildFillOrder, type FillRevealOptions } from './reveal.js'
import { svgSubpaths } from './svg-paths.js'

import { FIELD_WIDTH, FIELD_HEIGHT } from './constants.js'
const DISTANCE_RANGE = 16

/** The browser half of preparation: what the SVG covers, measured with the DOM and a canvas. */
export type ArtworkRaster = {
  /** Artwork bounds in the 650 × 500 preparation field. */
  bounds: { x: number; y: number; width: number; height: number }
  /** Coverage per field point, 0-255. */
  coverage: Uint8Array
  /** The artwork's paths as polylines in field units. The outline is drawn along them. */
  paths: readonly (readonly { x: number; y: number }[])[]
}

/** Reusable SVG geometry and coverage data ready for a Graphite renderer. */
export type PreparedArtwork = Omit<ArtworkRaster, 'coverage'> & {
  /** RGBA per field point: R coverage, G signed distance to the edge (±16 field units, 0.5 at
   * the edge), B unused, A when the fill appears while the drawing animates. */
  field: Uint8Array
  /** Data a brush worked out ahead of the first render, by brush name, such as
   * `pencil.prepare`'s. Optional: a brush builds whatever is missing. */
  brushData?: Readonly<Record<string, unknown>>
}

/**
 * Lists the transferable buffers for prepared artwork. Use the result as the
 * transfer list in `postMessage`. Transferring the buffers detaches them from the sender.
 */
export function artworkBuffers(artwork: PreparedArtwork): ArrayBuffer[] {
  const found = new Set<ArrayBuffer>()
  const visited = new WeakSet<object>()
  const visit = (value: unknown) => {
    if (!value || typeof value !== 'object' || visited.has(value)) return
    visited.add(value)
    if (ArrayBuffer.isView(value)) {
      if (value.buffer instanceof ArrayBuffer) found.add(value.buffer)
    } else if (value instanceof ArrayBuffer) {
      found.add(value)
    } else {
      for (const item of Object.values(value)) visit(item)
    }
  }
  visit(artwork.field)
  visit(artwork.brushData)
  return [...found]
}

// Chamfer distances give the shader a soft contour without shape-specific geometry.
function distances(inside: Uint8Array, target: number) {
  const w = FIELD_WIDTH,
    h = FIELD_HEIGHT
  const out = Float32Array.from(inside, (value) =>
    value === target ? 0 : 10000,
  )
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
  return out
}

function context() {
  const canvas = document.createElement('canvas')
  canvas.width = FIELD_WIDTH
  canvas.height = FIELD_HEIGHT
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Canvas preparation is unavailable')
  return ctx
}

/** Options for preparing SVG artwork or its intermediate raster. */
export type PrepareOptions = {
  /** The order the fill appears in while the drawing animates. Visibility only. */
  fillReveal?: Partial<FillRevealOptions>
}

/**
 * Converts trusted monochrome SVG markup into reusable drawing data.
 *
 * @param text - The contents of a self-contained SVG file.
 * @param options - Options for scheduling when the shading appears.
 * @returns Prepared artwork that can be reused across renderers and frames.
 *
 * Run this in a browser. Use `rasterizeSvg` and `prepareRaster` to split the
 * work between the main thread and a worker.
 */
export async function prepareSvg(
  text: string,
  options: PrepareOptions = {},
): Promise<PreparedArtwork> {
  return prepareRaster(await rasterizeSvg(text), options)
}

/**
 * Samples the paths and rasterizes the coverage of trusted SVG markup.
 * Run this in the browser and pass the result to `prepareRaster`.
 */
export async function rasterizeSvg(text: string): Promise<ArtworkRaster> {
  const svg = new DOMParser().parseFromString(
    text,
    'image/svg+xml',
  ).documentElement
  if (
    svg.localName !== 'svg' ||
    svg.namespaceURI !== 'http://www.w3.org/2000/svg'
  )
    throw new Error('Artwork must be valid SVG with an SVG namespace')
  const curves = svgSubpaths(svg)
  if (!curves.length) throw new Error('Artwork has no supported vector paths')
  // Measure one path at a time to bound temporary memory for complex artwork.
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const curve of curves) {
    const divisions = Math.min(2048, Math.max(8, Math.ceil(curve.length / 2)))
    for (const { x, y } of curve.spacedPoints(divisions)) {
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
  }
  const width = maxX - minX,
    height = maxY - minY
  const span = Math.max(width, height)
  if (!Number.isFinite(span) || span <= 0)
    throw new Error('Artwork has empty or nonfinite bounds')
  const padding = span * 0.055
  const scale = Math.min(
    FIELD_WIDTH / (width + padding * 2),
    FIELD_HEIGHT / (height + padding * 2),
  )
  const offsetX = (FIELD_WIDTH - width * scale) / 2 - minX * scale
  const offsetY = (FIELD_HEIGHT - height * scale) / 2 - minY * scale
  // Resample with a point every 2 artwork units, or every 4 field units where that is finer, so
  // small artwork drawn large (a 24-unit icon) keeps its round corners.
  const normalized = curves.map((curve) =>
    curve
      .spacedPoints(
        Math.min(
          2048,
          Math.max(
            8,
            Math.ceil(curve.length / 2),
            Math.ceil((curve.length * scale) / 4),
          ),
        ),
      )
      .map((p) => ({ x: p.x * scale + offsetX, y: p.y * scale + offsetY })),
  )
  svg.setAttribute('width', String(FIELD_WIDTH))
  svg.setAttribute('height', String(FIELD_HEIGHT))
  const viewWidth = FIELD_WIDTH / scale,
    viewHeight = FIELD_HEIGHT / scale
  svg.setAttribute(
    'viewBox',
    `${(minX + maxX - viewWidth) / 2} ${(minY + maxY - viewHeight) / 2} ${viewWidth} ${viewHeight}`,
  )
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet')
  const mask = context()
  const markup = new XMLSerializer().serializeToString(svg)
  const blob = URL.createObjectURL(
    new Blob([markup], { type: 'image/svg+xml' }),
  )
  const image = new Image()
  try {
    image.src = blob
    await image.decode()
    mask.drawImage(image, 0, 0, FIELD_WIDTH, FIELD_HEIGHT)
  } finally {
    URL.revokeObjectURL(blob)
  }
  const pixels = mask.getImageData(0, 0, FIELD_WIDTH, FIELD_HEIGHT).data
  const coverage = new Uint8Array(FIELD_WIDTH * FIELD_HEIGHT)
  for (let i = 0; i < coverage.length; i++) {
    const luminance =
      (pixels[i * 4] * 0.2126 +
        pixels[i * 4 + 1] * 0.7152 +
        pixels[i * 4 + 2] * 0.0722) /
      255
    coverage[i] = Math.round(pixels[i * 4 + 3] * (1 - luminance))
  }
  return {
    bounds: {
      x: minX * scale + offsetX,
      y: minY * scale + offsetY,
      width: width * scale,
      height: height * scale,
    },
    coverage,
    paths: normalized,
  }
}

/** Creates the distance field and fill timing from an SVG raster. Safe to call in a worker. */
export function prepareRaster(
  { bounds, coverage, paths }: ArtworkRaster,
  options: PrepareOptions = {},
): PreparedArtwork {
  const count = FIELD_WIDTH * FIELD_HEIGHT
  if (coverage.length !== count)
    throw new RangeError('Artwork coverage dimensions do not match the field')
  const inside = Uint8Array.from(coverage, (value) => (value > 12 ? 1 : 0))
  const fillOrder = buildFillOrder(coverage, options.fillReveal)
  const inner = distances(inside, 0),
    outer = distances(inside, 1)
  const field = new Uint8Array(count * 4)
  for (let i = 0; i < count; i++) {
    const distance = inside[i] ? inner[i] : -outer[i]
    field[i * 4] = coverage[i]
    field[i * 4 + 1] = Math.round(
      (0.5 +
        Math.max(-DISTANCE_RANGE, Math.min(DISTANCE_RANGE, distance)) /
          (DISTANCE_RANGE * 2)) *
        255,
    )
    field[i * 4 + 3] = fillOrder[i]
  }
  return { bounds, field, paths }
}
