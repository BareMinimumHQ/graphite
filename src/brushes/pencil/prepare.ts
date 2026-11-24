import type { PreparedArtwork } from '../../core/prepare.js'
import { farness } from '../../techniques/hatched-fill.js'
import { pathStrokes } from '../../techniques/path-line.js'
import { resolveStyle, type PencilStyle } from './style.js'

type Values = Record<string, number | readonly [number, number]>

/** Stroke data the pencil can build ahead of the first render. */
type PencilData = {
  /** How far each field point is from the shape, for culling far strokes. */
  farness: Uint8Array
  /** The outline's stroke vertices, for one count of firm passes and searching lines. */
  outline: { firmPasses: number; searchingLines: number; data: Float32Array }
}

/** Works out the stroke data the first render would otherwise build: the farness map and the
 * outline's strokes for `style`. Pure computation, so it can run in a worker; the pencil builds
 * anything missing or made for other pass counts. */
export function preparePencil(
  artwork: PreparedArtwork,
  style: PencilStyle = {},
): PreparedArtwork {
  const passes = outlinePasses(resolveStyle(style).outline.values)
  const data: PencilData = {
    farness: farness(artwork.field),
    outline: {
      ...passes,
      data: pathStrokes(
        artwork.paths,
        passes.searchingLines,
        passes.firmPasses,
      ),
    },
  }
  return { ...artwork, brushData: { ...artwork.brushData, pencil: data } }
}

/** The outline's pass counts for a style: firm passes and searching lines. */
export function outlinePasses(outline: Values) {
  return {
    firmPasses: outline.passCount as number,
    searchingLines: outline.searchCount as number,
  }
}

/** The stroke data `preparePencil` worked out for an artwork, if any. */
export function preparedStrokes(artwork: PreparedArtwork) {
  return artwork.brushData?.pencil as PencilData | undefined
}
