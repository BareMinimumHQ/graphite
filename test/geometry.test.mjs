import test from 'node:test'
import assert from 'node:assert/strict'
import { generateGuides } from '../dist/core/guides.js'
import { FIELD_WIDTH, FIELD_HEIGHT } from '../dist/core/constants.js'
import { buildFillOrder } from '../dist/core/reveal.js'
import { pencil } from '../dist/brushes/pencil/index.js'

test('guides share normalized artwork coordinates and are deterministic', () => {
  const artwork = { bounds: { x: 50, y: 60, width: 400, height: 300 } }
  const guides = generateGuides(artwork, { roughness: 0, overshoot: 10 })
  assert.deepEqual(guides.viewBox, [0, 0, 650, 500])
  assert.deepEqual(
    guides.paths.map((p) => p.id),
    ['top', 'bottom', 'left', 'right', 'x-axis', 'y-axis'],
  )
  assert.ok(guides.paths[0].d.startsWith('M40 60 C'))
  assert.ok(guides.paths[0].d.endsWith('460 60'))
  assert.deepEqual(generateGuides(artwork), generateGuides(artwork))
  assert.notDeepEqual(generateGuides(artwork), guides)
  assert.throws(() => generateGuides(artwork, { roughness: NaN }))
  assert.throws(() =>
    generateGuides({ bounds: { ...artwork.bounds, width: 0, height: 0 } }),
  )
  assert.deepEqual(
    generateGuides({ bounds: { ...artwork.bounds, width: 0 } }).paths.map(
      (p) => p.id,
    ),
    ['y-axis'],
  )
})

test('reveal schedules short local passes across the full artwork', () => {
  const coverage = new Uint8Array(FIELD_WIDTH * FIELD_HEIGHT)
  for (let y = 80; y < 420; y++)
    for (let x = 80; x < 570; x++) coverage[y * FIELD_WIDTH + x] = 255
  const before = coverage.slice()
  const order = buildFillOrder(coverage)
  assert.deepEqual(coverage, before)
  assert.deepEqual(order, buildFillOrder(coverage))
  const times = order.filter((_, i) => coverage[i] > 0)
  assert.ok(times.includes(0))
  assert.ok(times.includes(254))
  assert.ok(new Set(times).size > 240)
  // One diagonal spans multiple local passes instead of a single full-length wipe.
  const diagonal = [100, 180, 260, 340].map(
    (x) => order[(440 - x) * FIELD_WIDTH + x],
  )
  assert.ok(Math.max(...diagonal) - Math.min(...diagonal) > 5)
  assert.throws(() => buildFillOrder(new Uint8Array(coverage.length)))
})

test('timeline exposes sequential progress and supports immediate phases', async () => {
  const { createDrawingTimeline } = await import('../dist/index.js')
  const timeline = createDrawingTimeline(pencil)
  assert.deepEqual(timeline.at(-1), { outline: 0, shading: 0 })
  assert.deepEqual(timeline.at(timeline.duration), { outline: 1, shading: 1 })
  const shadingStart = timeline.layers.shading.start
  assert.equal(timeline.at(shadingStart).shading, 0)
  assert.equal(timeline.at(shadingStart).outline, 1)
  assert.deepEqual(
    createDrawingTimeline(pencil, {
      guides: 0,
      layers: { outline: 0, shading: 0 },
    }).at(0),
    { outline: 1, shading: 1 },
  )
  assert.throws(() =>
    createDrawingTimeline(pencil, { layers: { shading: NaN } }),
  )
  assert.throws(
    () => createDrawingTimeline(pencil, { layers: { smudge: 1 } }),
    TypeError,
  )
  assert.throws(() => createDrawingTimeline({ name: 'fake', layers: [] }))
  assert.throws(() => timeline.at(Infinity))
})

test('reveal controls change only the schedule and reject invalid settings', () => {
  const coverage = new Uint8Array(FIELD_WIDTH * FIELD_HEIGHT).fill(255)
  const defaults = buildFillOrder(coverage)
  for (const options of [
    { passLength: 80 },
    { bandWidth: 6 },
    { endpointJitter: 0 },
  ]) {
    assert.notDeepEqual(buildFillOrder(coverage, options), defaults)
  }
  for (const options of [
    { passLength: 0 },
    { bandWidth: 1.5 },
    { endpointJitter: 1000 },
  ])
    assert.throws(() => buildFillOrder(coverage, options))
})

test('shared stroke scheduling divides a fixed phase across arbitrary counts or weights', async () => {
  const { createStrokeSequence, createDrawingTimeline } =
    await import('../dist/index.js')
  for (const count of [0, 1, 3, 6, 19, 64]) {
    const sequence = createStrokeSequence(count, 2)
    assert.equal(sequence.length, count)
    if (count) {
      assert.equal(sequence[0].start, 0)
      assert.ok(
        Math.abs(sequence.at(-1).start + sequence.at(-1).duration - 2) < 1e-12,
      )
      for (const stroke of sequence)
        assert.ok(Math.abs(stroke.duration - 2 / count) < 1e-12)
    }
  }
  assert.deepEqual(createStrokeSequence([1, 3], 2), [
    { start: 0, duration: 0.5 },
    { start: 0.5, duration: 1.5 },
  ])
  assert.deepEqual(createStrokeSequence(2, 0), [
    { start: 0, duration: 0 },
    { start: 0, duration: 0 },
  ])
  for (const invalid of [-1, 1.5, Infinity, 4097, [1, 0], [1, NaN]])
    assert.throws(() => createStrokeSequence(invalid))
  const timeline = createDrawingTimeline(pencil, { guides: 0.42 })
  assert.deepEqual(timeline.layers, {
    outline: { start: 0.42, duration: 0.8 },
    shading: { start: 1.22, duration: 0.72 },
  })
  assert.equal(timeline.duration, 1.94)
})

test('custom guide lines of any supported count share the complete normalized phase', () => {
  const artwork = { bounds: { x: 50, y: 60, width: 400, height: 300 } }
  for (const count of [0, 1, 3, 9, 21]) {
    const lines = Array.from({ length: count }, (_, i) => ({
      id: `line-${i}`,
      from: [50, 60 + i],
      to: [450, 60 + i],
    }))
    const result = generateGuides(artwork, { lines })
    assert.equal(result.paths.length, count)
    if (count)
      assert.ok(
        Math.abs(result.paths.at(-1).start + result.paths.at(-1).duration - 1) <
          1e-12,
      )
    for (let i = 1; i < count; i++)
      assert.ok(
        Math.abs(
          result.paths[i].start -
            result.paths[i - 1].start -
            result.paths[i - 1].duration,
        ) < 1e-12,
      )
  }
  assert.throws(() =>
    generateGuides(artwork, {
      lines: [{ id: 'zero', from: [0, 0], to: [0, 0] }],
    }),
  )
  assert.throws(() =>
    generateGuides(artwork, {
      lines: [
        { id: 'x', from: [0, 0], to: [1, 1] },
        { id: 'x', from: [2, 2], to: [3, 3] },
      ],
    }),
  )
})
