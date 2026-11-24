# Graphite internals

Start with the [root README](../README.md) to use Graphite. This guide maps the source for contributors.

## Rendering pipeline

1. [Preparation](core/prepare.ts) samples paths and rasterizes coverage from the same SVG. Both use a 650 × 500 artwork field. The result contains the path samples and an RGBA byte buffer with coverage in red, signed distance in green and fill timing in alpha.
2. The [renderer](core/renderer.ts) uploads the field buffer as a texture and creates a draw quad and brush painter for each drawing. It checks render options and gives the painter a cleared framebuffer. A shared session copies each result into the drawing’s own Canvas 2D target.
3. The brush chooses how to render the prepared artwork. Pencil draws strokes into a float buffer, then applies paper texture, layer opacity and colour. It compiles shaders on the first render and rebuilds outline geometry when the pass counts change.

The host sets the canvas backing size and controls when renders occur. The preparation field stays the same size.

## Source layout

- `core/` owns SVG preparation, renderer lifetime, the brush contract, animation and guides.
- `brushes/` contains each brush's implementation and public entry point. See the [brush guide](brushes/README.md).
- `techniques/`, `surfaces/` and `utilities/` contain shared stroke geometry, paper texture and GPU buffers.
- `generated/shaders.ts` is produced by `generate-shaders.mjs` before TypeScript runs. Inlining the GLSL removes the need to fetch shader files at runtime.

For changes to preparation, rendering or shaders, compare a representative drawing and a simple shape before and after. Check outline only, shading only, a light colour, two sizes and intermediate animation progress.
