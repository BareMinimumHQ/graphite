// The pencil brush: `import { pencil } from '@bareminimum/graphite/pencil'`.
import { defineBrush } from '../../core/brush.js'
import { createPencilPainter } from './painter.js'
import { preparePencil } from './prepare.js'
import {
  pencilStyleSettings,
  resolveStyle,
  type PencilLayer,
  type PencilStyle,
} from './style.js'

/** A graphite pencil: an outline drawn along the artwork's paths, and hatched shading. */
export const pencil = defineBrush<
  PencilStyle,
  ReturnType<typeof resolveStyle>,
  PencilLayer,
  {
    name: 'pencil'
    layers: readonly PencilLayer[]
    settings: typeof pencilStyleSettings
    prepare: typeof preparePencil
  }
>(
  {
    name: 'pencil',
    layers: ['outline', 'shading'],
    /** The settings per layer, with their defaults and ranges. */
    settings: pencilStyleSettings,
    /** Builds the pencil's stroke data ahead of the first render, for example in a worker. */
    prepare: preparePencil,
  },
  {
    resolve: resolveStyle,
    durations: { outline: 0.8, shading: 0.72 },
    createPainter: createPencilPainter,
  },
)

export type {
  PencilLayer,
  PencilOutlineStyle,
  PencilSetting,
  PencilShaderValues,
  PencilShadingStyle,
  PencilStyle,
} from './style.js'
export {
  renderSmudge,
  type SmudgeBounds,
  type SmudgeOptions,
} from './smudge.js'
