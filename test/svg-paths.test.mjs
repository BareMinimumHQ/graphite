import test from 'node:test'
import assert from 'node:assert/strict'
import { pathSubpaths } from '../dist/core/svg-paths.js'

const close = (actual, expected, tolerance = 1e-6) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} is not within ${tolerance} of ${expected}`,
  )

test('splits subpaths, including commands that continue after Z', () => {
  const parts = pathSubpaths('M0 0 H10 V10 Z L0 -5 m 20 0 l 4 0')
  assert.deepEqual(
    parts.map((part) => [part.length, part.closed]),
    [
      [20 + Math.hypot(10, 10), true],
      [5, false],
      [4, false],
    ],
  )
  // The run after Z starts at the closed subpath's first point.
  assert.deepEqual(parts[1].spacedPoints(1), [
    { x: 0, y: 0 },
    { x: 0, y: -5 },
  ])
  // The relative move continues from where the previous run ended.
  assert.deepEqual(parts[2].spacedPoints(1)[0], { x: 20, y: -5 })
})

test('closed subpaths sample the closing edge at the same spacing', () => {
  const [square] = pathSubpaths('M0 0 L10 0 L10 10 L0 10 Z')
  assert.equal(square.length, 40)
  const points = square.spacedPoints(4)
  assert.equal(points.length, 5)
  assert.deepEqual(points.at(-1), points[0])
  assert.deepEqual(points[1], { x: 10, y: 0 })
  assert.deepEqual(points[3], { x: 0, y: 10 })
})

test('samples evenly by arc length and applies the transform', () => {
  const [circle] = pathSubpaths('M10 0 A10 10 0 1 1 -10 0 A10 10 0 1 1 10 0')
  close(circle.length, 20 * Math.PI, 0.05)
  // Arcs become cubic curves, which stay within 0.2% of the true radius.
  for (const { x, y } of circle.spacedPoints(16))
    close(Math.hypot(x, y), 10, 0.02)

  const matrix = { a: 2, b: 0, c: 0, d: 2, e: 5, f: -5 }
  const [line] = pathSubpaths('M0 0 L3 4', matrix)
  assert.equal(line.length, 10)
  assert.deepEqual(line.spacedPoints(2), [
    { x: 5, y: -5 },
    { x: 8, y: -1 },
    { x: 11, y: 3 },
  ])
})

test('ignores moves that draw nothing', () => {
  assert.equal(pathSubpaths('M0 0 M5 5 L6 5 M9 9').length, 1)
  assert.equal(pathSubpaths('').length, 0)
})

test('reads arc flags packed without separators', () => {
  const [packed] = pathSubpaths('M0 0a5 5 0 1010 0')
  const [spaced] = pathSubpaths('M0 0a5 5 0 1 0 10 0')
  assert.equal(packed.length, spaced.length)
  assert.deepEqual(packed.spacedPoints(1)[1], { x: 10, y: 0 })
})
