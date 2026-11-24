# Brush development

A brush defines how to draw prepared artwork. It owns its settings, drawing layers, shaders and painter. Pencil is the current built-in brush. Brush authoring uses an internal contract.

## Contract

Register the brush with `defineBrush(face, definition)` in the [brush contract](../core/brush.ts):

- The public `face` provides the brush name, layer order and optional helpers.
- `resolve(style)` validates user settings and fills in defaults.
- `durations` provides default layer timings for `createDrawingTimeline`.
- `createPainter(context)` creates a painter for one drawing. Before each paint, the renderer binds the field texture at unit 0, the draw quad and a cleared output framebuffer. The painter receives colour in linear RGB and per-layer progress from 0 to 1. It releases its GPU resources in `dispose()`.

## Pencil

[Pencil’s entry point](pencil/index.ts) assembles the brush. [Style resolution](pencil/style.ts) and [settings](pencil/settings.ts) map user inputs to shader values using the calibrated [grade curves](pencil/grades.ts). [Preparation](pencil/prepare.ts) can compute stroke data before rendering. The [painter](pencil/painter.ts) runs the stroke and paper passes. [Smudging](pencil/smudge.ts) uses a separate Canvas 2D path.

The stroke shaders in `pencil.glsl` draw hatching and outline geometry into a float buffer. The paper pass reads the buffer, applies paper texture and sends layer coverage to [the shared composition shader](../core/shaders/compose.glsl), which applies opacity and colour. Use the shared field helpers for distance calculations. Signed distances are reliable within 16 field units of an edge.

The shader header declares inputs such as:

```glsl
// @brush pencil
// @param outline.opacity float 0.9 0..1 Completed outline opacity
// @param shading.endReach range 1,7 -8..16 Stroke reach in field units
```

The build parses each `brushes/<name>/<name>.glsl` header. A `float` declares one number and a `range` declares an increasing pair. These settings become uniforms, except for `outline.opacity` and `shading.opacity`, which the shared composition pass applies. Declare both opacity settings as floats.

When adding a built-in brush, add its source folder and a public subpath export. Build and test the brush and compare example renders before shipping it.
