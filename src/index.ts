export {
  artworkBuffers,
  prepareRaster,
  prepareSvg,
  rasterizeSvg,
  type ArtworkRaster,
  type PreparedArtwork,
  type PrepareOptions,
} from './core/prepare.js'
export type { FillRevealOptions } from './core/reveal.js'
export type { Brush } from './core/brush.js'
export {
  createRenderer,
  createRenderingSession,
  type GraphiteRenderer,
  type GraphiteRenderingSession,
  type RenderOptions,
  type RendererOptions,
} from './core/renderer.js'
export { defaultColor } from './core/constants.js'
export {
  createDrawingTimeline,
  createStrokeSequence,
  type DrawingTimeline,
  type DrawingTiming,
  type StrokeTiming,
} from './core/animation.js'
