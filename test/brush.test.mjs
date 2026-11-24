import test from 'node:test'
import assert from 'node:assert/strict'
import * as graphite from '../dist/index.js'
import { pencil } from '../dist/brushes/pencil/index.js'
import { resolveStyle } from '../dist/brushes/pencil/style.js'
import { brushSources } from '../dist/generated/shaders.js'

test('package imports without browser globals and exposes an immutable pencil', () => {
  assert.equal(typeof graphite.createRenderer, 'function')
  assert.equal(typeof graphite.prepareSvg, 'function')
  assert.equal(graphite.defaultColor, '#36352e')
  // Brushes come from their own entry points; the core names none.
  assert.equal('brushes' in graphite, false)
  assert.equal(pencil.name, 'pencil')
  assert.deepEqual(pencil.layers, ['outline', 'shading'])
  assert.throws(() => {
    pencil.name = 'chalk'
  }, TypeError)
  assert.throws(() => {
    pencil.settings.shading[0].default = 0
  }, TypeError)
  assert.throws(() => {
    pencil.settings.outline.push({})
  }, TypeError)
  assert.deepEqual(pencil.settings.shading.map((s) => s.key).slice(0, 4), [
    'opacity',
    'angle',
    'grade',
    'pressure',
  ])
})

test('only package brushes can draw', () => {
  const canvas = {}
  assert.throws(
    () =>
      graphite.createRenderer(canvas, {
        artwork: {},
        brush: { name: 'chalk', layers: ['outline'] },
      }),
    /package brushes/,
  )
})

test('pencil.prepare keeps plain, transferable stroke data', () => {
  const artwork = {
    bounds: { x: 0, y: 0, width: 650, height: 500 },
    field: new Uint8Array(650 * 500 * 4),
    paths: [
      [
        { x: 10, y: 10 },
        { x: 200, y: 10 },
      ],
    ],
  }
  const prepared = pencil.prepare(artwork)
  assert.equal(prepared.field, artwork.field)
  const data = prepared.brushData.pencil
  assert.ok(data.farness instanceof Uint8Array)
  assert.ok(data.outline.data instanceof Float32Array)
  assert.equal(data.outline.searchingLines, 6)
  assert.deepEqual(graphite.artworkBuffers(prepared), [
    artwork.field.buffer,
    data.farness.buffer,
    data.outline.data.buffer,
  ])
  // Survives a structured clone, as across a worker boundary.
  assert.deepEqual(globalThis.structuredClone(prepared), prepared)
})

test('artworkBuffers lists transferable buffers once and skips shared storage', () => {
  const field = new Uint8Array(4)
  const direct = new ArrayBuffer(4)
  const shared = new Uint8Array(new SharedArrayBuffer(4))
  const brushData = { sameField: field.subarray(1), direct, shared }
  brushData.self = brushData
  const artwork = { field, brushData }
  const transfer = graphite.artworkBuffers(artwork)
  assert.deepEqual(transfer, [field.buffer, direct])
  assert.deepEqual(
    globalThis.structuredClone(artwork, { transfer }).field,
    new Uint8Array(4),
  )
})

test('every parameter the pencil header declares is used by its source', () => {
  // The renderer applies opacity and builds the outline's passes; the rest reach the shader.
  const notInShader = ['opacity', 'passCount', 'searchCount']
  for (const param of brushSources.pencil.params)
    if (!notInShader.includes(param.key))
      assert.ok(
        brushSources.pencil.source.includes(`${param.layer}_${param.key}`),
        `${param.layer}.${param.key} is unused`,
      )
})

test('partial settings resolve against brush defaults on every call', () => {
  const style = resolveStyle({
    outline: { width: 0.5 },
    shading: { opacity: 0.5 },
  })
  assert.equal(style.paper, 0.5)
  assert.ok(
    style.outline.values.lineWidth > resolveStyle().outline.values.lineWidth,
  )
  assert.equal(style.outline.opacity, 0.9)
  assert.equal(style.shading[0].opacity, 0.5)
  assert.deepEqual(style.shading[0].values, resolveStyle().shading[0].values)
  assert.deepEqual(
    resolveStyle({ outline: { width: undefined } }).outline,
    resolveStyle().outline,
  )
})

test('outline settings are independent of shading', () => {
  const base = resolveStyle()
  const changed = resolveStyle({
    outline: { width: 0.8, pressure: 0.9, enabled: false },
  })
  assert.deepEqual(changed.shading, base.shading)
  assert.equal(changed.outline.enabled, false)
  assert.equal(base.shading[0].enabled, true)
})

test('unknown, unsafe or malformed settings fail before shader compilation', () => {
  for (const options of [
    { paper: -0.1 },
    // Internal values go under `shader`, never beside the artist's settings.
    { shading: { strokeSpacing: 2 } },
    { shading: { shader: { strokeSpacing: 0 } } },
    { shading: { shader: { grade: 2 } } },
    { shading: { shader: 3 } },
    { shading: { opacity: NaN } },
    { shading: { shader: { endReach: [0, 20] } } },
    { shading: { shader: { endReach: [5, 1] } } },
    { shading: { shader: { endReach: 1 } } },
    { shading: { pressure: Infinity } },
    { shading: { thickness: 1 } },
    { outline: { wobble: 1.1 } },
    { outline: { searchingLines: 2.5 } },
    { outline: { enabled: 'yes' } },
    { outline: { width: NaN } },
    { outline: { thickness: 0.5 } },
    { outline: { passes: 0 } },
    { outline: { typo: 1 } },
  ])
    assert.throws(
      () => resolveStyle(options),
      undefined,
      JSON.stringify(options),
    )
})
