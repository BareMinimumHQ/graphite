import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { URL } from 'node:url'
import { resolveStyle } from '../dist/brushes/pencil/style.js'
import { brushSources } from '../dist/generated/shaders.js'

const tune = JSON.parse(
  readFileSync(new URL('./fixtures/pencil-calibration.json', import.meta.url)),
)
const params = Object.fromEntries(
  brushSources.pencil.params
    .filter((p) => p.layer === 'shading')
    .map((p) => [p.key, p]),
)
const shading = (settings) =>
  resolveStyle({ shading: settings }).shading[0].values

test('each grade at the default draw settings reproduces the matched tune', () => {
  Object.entries(tune).forEach(([name, tuned], index) => {
    const values = shading({ grade: index - 10 })
    for (const [key, expected] of Object.entries(tuned)) {
      const setting = key.split('.')[1]
      if (!setting || setting === 'darkness') continue
      const { min, max } = params[setting]
      assert.ok(
        Math.abs(values[setting] - expected) <= 0.01 * (max - min),
        `${name} ${setting}: ${values[setting]} vs ${expected}`,
      )
    }
    // Darkness also carries the grade's tuned pencil colour, so compare the tone it gives.
    const ink = (darkness, luminance) => darkness * (1 - luminance)
    assert.ok(
      Math.abs(
        ink(values.darkness, 0.0352) -
          ink(tuned['shading.darkness'], tuned.colorLuminance),
      ) < 0.01,
      `${name} darkness`,
    )
  })
})

test('draw settings move the internal settings they own', () => {
  const base = shading({})
  assert.ok(shading({ pressure: 1 }).load > base.load)
  assert.ok(shading({ pressure: 1 }).toothFill > base.toothFill)
  assert.equal(shading({ pressure: 0.5 }).toothFill, base.toothFill)
  assert.ok(shading({ density: 1 }).strokeSpacing < base.strokeSpacing)
  const ruled = shading({ wobble: 0, arc: 0 })
  for (const key of ['wander', 'tremor', 'handArc', 'laneJitter'])
    assert.equal(ruled[key], 0, key)
  const far = shading({ overshoot: 1, raggedness: 1 }).endReach
  const near = shading({ overshoot: 0.5, raggedness: 1 }).endReach
  assert.ok(far[0] > near[0])
  assert.equal(base.inset, 0)
  assert.ok(shading({ width: 1 }).strokeWidth > base.strokeWidth)
  assert.ok(shading({ width: 0 }).strokeWidth < base.strokeWidth)
  // Width is the line alone: spacing and darkness per line stay put.
  const broad = shading({ width: 0.75 })
  assert.equal(broad.strokeSpacing, base.strokeSpacing)
  assert.equal(broad.load, base.load)
  assert.deepEqual(shading({ wobble: 1 }).endReach, base.endReach)
  assert.ok(shading({ overshoot: 0 }).inset > 0)
  assert.ok(shading({ overshoot: -1 }).inset > shading({ overshoot: 0 }).inset)
  assert.equal(shading({ raggedness: 0 }).raggedEnds, 0)
  // Raggedness pulls ends back but never pushes the furthest one further out.
  assert.equal(
    shading({ raggedness: 1 }).endReach[1],
    shading({ raggedness: 0 }).endReach[1],
  )
})

test('every artist setting resolves at both ends of its range', () => {
  for (const key of [
    'pressure',
    'density',
    'wobble',
    'width',
    'arc',
    'overshoot',
    'raggedness',
  ])
    for (const value of [key === 'overshoot' || key === 'arc' ? -1 : 0, 1])
      shading({ grade: 8, [key]: value })
  assert.ok(shading({ arc: -1 }).handArc < 0)
  shading({
    grade: -10,
    pressure: 1,
    density: 1,
    wobble: 1,
    arc: 1,
  })
})

test('grade must be a whole number in range, and internal values passed explicitly win', () => {
  assert.throws(() => shading({ grade: 0.5 }), RangeError)
  assert.throws(() => shading({ grade: 9 }), RangeError)
  assert.equal(
    shading({ grade: 4, shader: { toothFill: 0.123 } }).toothFill,
    0.123,
  )
})

test('shading can be several layers, each with its own settings', () => {
  const { shading } = resolveStyle({
    shading: [{ grade: -2 }, { grade: -2, angle: 135, pressure: 0.3 }],
  })
  assert.equal(shading.length, 2)
  assert.equal(shading[1].values.angle, 135)
  assert.ok(shading[1].values.load < shading[0].values.load)
  assert.deepEqual(resolveStyle({ shading: [] }).shading, [])
})

test('paper is shared by every layer', () => {
  const rough = resolveStyle({
    paper: 1,
    shading: [{}, { grade: 4 }],
  }).shading
  const base = resolveStyle({}).shading[0].values
  assert.equal(base.grainSize, 1)
  for (const layer of rough) assert.ok(layer.values.grainSize > 1)
  assert.throws(() => resolveStyle({ paper: 2 }), RangeError)
})

const outline = (settings) => resolveStyle({ outline: settings }).outline.values

test('outline artist settings: HB at the defaults is the shader default line', () => {
  const base = outline({})
  assert.equal(base.darkness, 1)
  assert.ok(Math.abs(base.lineWidth - 1) < 1e-9)
  assert.equal(base.spread, 1)
  assert.ok(outline({ grade: 8 }).darkness > base.darkness)
  assert.ok(outline({ grade: 8 }).lineWidth > base.lineWidth)
  assert.ok(outline({ pressure: 1 }).darkness > base.darkness)
  assert.equal(outline({ wobble: 0 }).spread, 0)
  for (const key of ['pressure', 'wobble'])
    for (const value of [0, 1]) outline({ grade: 8, [key]: value })
  outline({ grade: -10, pressure: 0, wobble: 1, width: 1 })
  // Width is each pass's line width; passes don't change it.
  assert.equal(base.passCount, 2)
  assert.equal(outline({ passes: 8 }).lineWidth, base.lineWidth)
  assert.ok(outline({ width: 1 }).lineWidth > 6 * base.lineWidth)
  assert.ok(outline({ width: 0 }).lineWidth < base.lineWidth)
  assert.equal(outline({}).band, undefined)
  assert.equal(outline({ passes: 5 }).passCount, 5)
  assert.throws(() => outline({ passes: 2.5 }), RangeError)
  assert.throws(() => outline({ passes: 0 }), RangeError)
  assert.throws(() => outline({ width: 1.5 }), RangeError)
  assert.equal(outline({ grade: 8, shader: { darkness: 0.4 } }).darkness, 0.4)
  assert.throws(() => outline({ grade: 1.5 }), RangeError)
  // Searching lines are outline draw settings, not a prepare option.
  assert.equal(base.searchCount, 6)
  assert.equal(outline({ searchingLines: 0 }).searchCount, 0)
  assert.throws(() => outline({ searchingLines: 2.5 }), RangeError)
  assert.equal(outline({ searchingSpread: 0 }).searchStray, 0)
  assert.ok(outline({ searchingSpread: 1 }).searchStray > base.searchStray)
  assert.ok(
    outline({ searchingPressure: 1 }).exploratoryDensity >
      base.exploratoryDensity,
  )
})

test('the outline takes its grain from its own grade, never the shading', () => {
  const line = (style) => resolveStyle(style).outline.values
  const base = line({ outline: { grade: 8 } })
  // The same grade draws the same grain in either layer.
  assert.equal(base.toothFill, shading({ grade: 8 }).toothFill)
  assert.deepEqual(
    line({
      outline: { grade: 8 },
      shading: { grade: -6, pressure: 1, wobble: 0, density: 1, angle: 90 },
    }),
    base,
  )
  assert.ok(line({ outline: { grade: -6 } }).toothFill > base.toothFill)
  // Rough paper fills less readily, under the line as under the shading.
  assert.ok(
    line({ paper: 1, outline: { grade: 8 } }).toothFill < base.toothFill,
  )
})

test('the JavaScript paper is a port of the shader paper', async () => {
  const { paperHeight, grainSize } = await import('../dist/surfaces/paper.js')
  const glsl = readFileSync(
    new URL('../src/brushes/pencil/pencil.glsl', import.meta.url),
    'utf8',
  )
  // The shared recipe's constants must match the shader's.
  for (const constant of [
    '* 6.2832',
    '.5 + .7 *',
    '* 1.17',
    '*= .6',
    '*= 2.03',
    '* 17.3',
    'smoothstep(.2, .8',
    'smoothstep(.5, .7',
  ])
    assert.ok(glsl.includes(constant), constant)
  let sum = 0
  for (let i = 0; i < 2000; i++) {
    const h = paperHeight(i * 1.37, i * 0.71, 1)
    assert.ok(h >= 0 && h <= 1)
    sum += h
  }
  assert.ok(Math.abs(sum / 2000 - 0.5) < 0.05)
  assert.equal(grainSize(0.5), 1)
})

test('artist settings never share a name with an internal shader setting', async () => {
  const { pencilSettings, pencilOutlineSettings } =
    await import('../dist/brushes/pencil/settings.js')
  // A shared name would hide the internal setting from the matching tools.
  for (const [layer, list] of [
    ['shading', pencilSettings],
    ['outline', pencilOutlineSettings],
  ]) {
    const internal = brushSources.pencil.params
      .filter((p) => p.layer === layer)
      .map((p) => p.key)
    for (const { key } of list)
      assert.ok(!internal.includes(key), `${layer}.${key}`)
  }
})

test('stroke length: 1 never lifts, shorter strokes lift sooner', () => {
  assert.equal(shading({}).liftLength, 0)
  assert.equal(shading({ strokeLength: 1 }).liftLength, 0)
  assert.equal(shading({ strokeLength: 0 }).liftLength, 16)
  assert.ok(
    shading({ strokeLength: 0.8 }).liftLength >
      shading({ strokeLength: 0.2 }).liftLength,
  )
  assert.throws(() => shading({ strokeLength: 1.5 }), RangeError)
})
