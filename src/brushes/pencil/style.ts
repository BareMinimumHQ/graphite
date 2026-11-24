// The pencil's style: the artist's settings, checked and turned into the shader's values.
import { brushSources } from '../../generated/shaders.js'
import {
  paperSetting,
  pencilOutline,
  pencilOutlineSettings,
  pencilSettings,
  pencilShading,
  type PencilOutlineSettings,
  type PencilSettings,
} from './settings.js'

/** Pencil layers in drawing order. */
export type PencilLayer = 'outline' | 'shading'
type ShaderValue = number | readonly [number, number]

/** Experimental overrides for shader settings. Keys and ranges can change between releases. */
export type PencilShaderValues = Readonly<Record<string, ShaderValue>>

type LayerSwitches = {
  /** Draws the layer. Defaults to true. */
  enabled?: boolean
  /** Opacity of the completed layer, 0 to 1. */
  opacity?: number
  /** Experimental shader values that override the normal settings. */
  shader?: PencilShaderValues
}
/** The outline: grade, pressure, passes, wobble, width and the searching lines. */
export type PencilOutlineStyle = LayerSwitches & PencilOutlineSettings
/** One shading layer: grade, pressure, density, wobble, width, arc, overshoot, raggedness, stroke
 * length and angle. */
export type PencilShadingStyle = LayerSwitches &
  PencilSettings & {
    /** Hatching direction in degrees, counter-clockwise from horizontal. */
    angle?: number
  }

/** Everything the pencil draws with. Partial settings resolve against the defaults on every render. */
export type PencilStyle = {
  /** The paper, shared by every layer, from 0 (smooth) to 1 (rough). */
  paper?: number
  /** Settings for tracing the artwork paths. */
  outline?: PencilOutlineStyle
  /** One shading layer, or several drawn on top of each other (for example 2H at 0° and 2H at
   * 45° for a light cross-hatch). An empty list draws no shading. */
  shading?: PencilShadingStyle | readonly PencilShadingStyle[]
}

export type ResolvedLayer = {
  enabled: boolean
  opacity: number
  values: Record<string, ShaderValue>
}
export type ResolvedStyle = {
  paper: number
  outline: ResolvedLayer
  /** Shading layers in drawing order. */
  shading: ResolvedLayer[]
}

type ArtistSetting = Readonly<{
  key: string
  default: number
  min: number
  max: number
  integer?: true
}>
const artistSettings = {
  outline: pencilOutlineSettings,
  shading: pencilSettings,
} as const satisfies Record<PencilLayer, readonly ArtistSetting[]>
/** Header parameters the artist sets directly; the rest are internal shader values. */
const directKeys = { outline: ['opacity'], shading: ['opacity', 'angle'] }

// Lookups per layer, built once so per-frame renders only validate values.
const layerParams = Object.fromEntries(
  (['outline', 'shading'] as const).map((layer) => {
    const params = brushSources.pencil.params.filter((p) => p.layer === layer)
    const direct = new Set(directKeys[layer])
    return [
      layer,
      {
        params,
        settings: new Set([
          'enabled',
          'shader',
          ...direct,
          ...artistSettings[layer].map((setting) => setting.key),
        ]),
        shader: new Set(
          params.map((p) => p.key).filter((key) => !direct.has(key)),
        ),
      },
    ]
  }),
) as Record<
  PencilLayer,
  {
    params: (typeof brushSources.pencil.params)[number][]
    settings: Set<string>
    shader: Set<string>
  }
>

function checkNumber(
  value: unknown,
  range: { min: number; max: number },
  name: string,
) {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < range.min ||
    value > range.max
  )
    throw new RangeError(
      `${name} must be between ${range.min} and ${range.max}`,
    )
}

/** The artist's settings become internal shader values. */
function mapArtistSettings(
  layer: PencilLayer,
  options: Record<string, unknown>,
  paper: number,
) {
  const list: readonly ArtistSetting[] = artistSettings[layer]
  const settings = Object.fromEntries(
    list.map((setting) => {
      const value = options[setting.key] ?? setting.default
      const name = `${layer}.${setting.key}`
      checkNumber(value, setting, name)
      if (setting.integer && !Number.isInteger(value))
        throw new RangeError(`${name} must be a whole number`)
      return [setting.key, value as number]
    }),
  )
  return layer === 'shading'
    ? pencilShading(settings as Required<PencilSettings>, paper)
    : pencilOutline(settings as Required<PencilOutlineSettings>, paper)
}

function resolveLayer(
  layer: PencilLayer,
  options: Record<string, unknown> = {},
  paper: number,
): ResolvedLayer {
  const { params, settings, shader } = layerParams[layer]
  for (const key of Object.keys(options))
    if (options[key] !== undefined && !settings.has(key))
      throw new TypeError(`${layer}.${key} is not a pencil setting`)
  const overrides = (options.shader ?? {}) as Record<string, unknown>
  if (typeof overrides !== 'object')
    throw new TypeError(`${layer}.shader must be an object`)
  for (const key of Object.keys(overrides))
    if (overrides[key] !== undefined && !shader.has(key))
      throw new TypeError(`${layer}.shader.${key} is not a pencil shader value`)
  // Values passed explicitly win over the ones the settings work out.
  const chosen: Record<string, unknown> = {
    ...mapArtistSettings(layer, options, paper),
  }
  for (const key of directKeys[layer])
    if (options[key] !== undefined) chosen[key] = options[key]
  for (const [key, value] of Object.entries(overrides))
    if (value !== undefined) chosen[key] = value
  const enabled = options.enabled ?? true
  if (typeof enabled !== 'boolean')
    throw new TypeError(`${layer}.enabled must be boolean`)
  const values: ResolvedLayer['values'] = {}
  for (const param of params) {
    const name = `${layer}.${param.key}`
    const value = chosen[param.key] ?? param.default
    if (param.type === 'range') {
      if (!Array.isArray(value) || value.length !== 2)
        throw new TypeError(`${name} must be a two-number range`)
      checkNumber(value[0], param, name)
      checkNumber(value[1], param, name)
      if (value[0] >= value[1])
        throw new RangeError(`${name} must be increasing`)
      values[param.key] = [value[0], value[1]]
    } else {
      checkNumber(value, param, name)
      values[param.key] = value as number
    }
  }
  // The header declares a float `opacity` per layer; the paper pass applies it, not the shader.
  const opacity = values.opacity as number
  delete values.opacity
  return { enabled, opacity, values }
}

export function resolveStyle(style: PencilStyle = {}): ResolvedStyle {
  if (typeof style !== 'object' || style === null)
    throw new TypeError('style must be an object')
  const paper: unknown = style.paper ?? paperSetting.default
  checkNumber(paper, paperSetting, 'paper')
  return {
    paper: paper as number,
    outline: resolveLayer('outline', style.outline, paper as number),
    shading: (Array.isArray(style.shading)
      ? style.shading
      : [style.shading]
    ).map((layer) => resolveLayer('shading', layer, paper as number)),
  }
}

/** One setting the artist can change, with its default and range. */
export type PencilSetting = Readonly<{
  /** Setting name within its layer. */
  key: string
  /** Value used when the setting is omitted. */
  default: number
  /** Smallest accepted value. */
  min: number
  /** Largest accepted value. */
  max: number
  /** Only whole numbers. */
  integer?: true
}>

const header = (layer: PencilLayer, key: string): PencilSetting => {
  const param = brushSources.pencil.params.find(
    (p) => p.layer === layer && p.key === key,
  )!
  return Object.freeze({
    key,
    default: param.default as number,
    min: param.min,
    max: param.max,
  })
}
/** The pencil's settings per layer, with their defaults and ranges. */
export const pencilStyleSettings: Readonly<{
  paper: PencilSetting
  outline: readonly PencilSetting[]
  shading: readonly PencilSetting[]
}> = Object.freeze({
  paper: Object.freeze({ ...paperSetting }),
  outline: Object.freeze([
    header('outline', 'opacity'),
    ...pencilOutlineSettings.map((s) => Object.freeze({ ...s })),
  ]),
  shading: Object.freeze([
    header('shading', 'opacity'),
    header('shading', 'angle'),
    ...pencilSettings.map((s) => Object.freeze({ ...s })),
  ]),
})
