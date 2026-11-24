// The contract between the renderer and a brush. Internal for now: brushes ship with the package,
// so users can pass one to `createRenderer` but cannot write their own yet.
import type { PreparedArtwork } from './prepare.js'

declare const styleType: unique symbol

/**
 * A built-in brush accepted by the renderer. Each brush defines its settings
 * type and drawing layers. Import the brush from its package entry point.
 */
export type Brush<Style = unknown, Layer extends string = string> = {
  /** Stable identifier for the medium, such as `pencil`. */
  readonly name: string
  /** The brush's layers, in the order they draw. Drawing progress is set per layer. */
  readonly layers: readonly Layer[]
  /** Type only: the style this brush draws. */
  readonly [styleType]?: Style
}

/** What the renderer gives a brush when it starts drawing on a canvas. */
export type BrushContext = {
  gl: WebGL2RenderingContext
  canvas: HTMLCanvasElement
  artwork: PreparedArtwork
  /** The two triangles covering the canvas. The renderer binds this quad before each paint. */
  quad: WebGLVertexArrayObject
  /** Restores the renderer's blending after a brush changes it. */
  restoreBlend(): void
}

/** One brush drawing on one canvas. */
export type BrushPainter<Resolved, Layer extends string> = {
  /** Draws the resolved style onto a cleared canvas, with the viewport set. `color` is linear RGB. */
  paint(
    style: Resolved,
    color: readonly [number, number, number],
    progress: Readonly<Record<Layer, number>>,
  ): void
  /** Releases the brush's GPU resources. The renderer releases its own. */
  dispose(): void
}

type BrushDefinition<Style, Resolved, Layer extends string> = {
  /** Checks a style and fills in its defaults. Throws before anything is drawn. */
  resolve(style: Style | undefined): Resolved
  /** Seconds each layer takes by default when the drawing animates. */
  durations: Readonly<Record<Layer, number>>
  createPainter(context: BrushContext): BrushPainter<Resolved, Layer>
}

// Keyed by the brush object, so only brushes made here can draw.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const definitions = new WeakMap<object, BrushDefinition<any, any, any>>()

/** Makes a brush from its public face (name, layers and any extras) and its definition. */
export function defineBrush<
  Style,
  Resolved,
  Layer extends string,
  Face extends { name: string; layers: readonly Layer[] },
>(
  face: Face,
  definition: BrushDefinition<Style, Resolved, Layer>,
): Readonly<Face> & Brush<Style, Layer> {
  const brush = Object.freeze({
    ...face,
    layers: Object.freeze([...face.layers]),
  })
  definitions.set(brush, definition)
  return brush as Readonly<Face> & Brush<Style, Layer>
}

/** Looks up the internal definitions of a registered brush. */
export function brushDefinition<Style, Layer extends string>(
  brush: Brush<Style, Layer>,
): BrushDefinition<Style, unknown, Layer> {
  const definition = definitions.get(brush)
  if (!definition)
    throw new TypeError(
      'brush must be one of the package brushes, such as pencil',
    )
  return definition
}
