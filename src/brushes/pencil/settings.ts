import { gradeCurves, sharedSettings } from './grades.js'
import { grainSize } from '../../surfaces/paper.js'

/** The settings an artist chooses, as opposed to the shader's internal ones in pencil.glsl. */
export type PencilSettings = {
  /** Whole grades from -10 (10H) to 8 (8B). HB is 0. */
  grade?: number
  /** How hard the pencil is pressed, 0 to 1. 0.5 is the pressure the grades were matched at;
   * 0 is the lightest touch, which only catches the paper's peaks. */
  pressure?: number
  /** How closely strokes are hatched, 0 to 1: lower leaves more paper between lines. 0.5 is the
   * matched spacing. */
  density?: number
  /** How unsteady the hand is, 0 (straight, evenly spaced lines) to 1: lines drift and shake,
   * bunching in places and parting in others, where paper shows. 0.5 is the matched hand. */
  wobble?: number
  /** How far the strokes run past the outline, -1 to 1. 1 runs well past; 0 stops them under
   * the line; -1 stops them well short of it, leaving a rim of bare paper. */
  overshoot?: number
  /** How uneven the stroke ends are, 0 (they end along one smooth line) to 1 (very uneven).
   * The metric that matched the grades ignores the ends, so neither end setting is matched. */
  raggedness?: number
  /** How wide each line is, 0 (a freshly sharpened point, a fine line) to 1 (a blunt, worn point, a
   * broad line). 0.5 is the point the grades were matched with. Density spaces the lines, so broader
   * lines at the same density leave narrower gaps and cover more of the paper. */
  width?: number
  /** How much the strokes curve as the wrist pivots, -1 to 1. 0 is straight; negative values
   * curve the other way, as from the other hand or a turned page. */
  arc?: number
  /** How long each stroke is before the hand lifts and starts the next, 0 (short flicks) to 1
   * (one stroke across the whole shape, never lifting). Each stroke tapers in and out, so shorter
   * strokes show more stroke ends and short slivers of paper where they meet. */
  strokeLength?: number
}

export const pencilSettings = [
  { key: 'grade', default: 0, min: -10, max: 8, integer: true },
  { key: 'pressure', default: 0.5, min: 0, max: 1 },
  { key: 'density', default: 0.5, min: 0, max: 1 },
  { key: 'wobble', default: 0.5, min: 0, max: 1 },
  { key: 'width', default: 0.5, min: 0, max: 1 },
  { key: 'arc', default: 0.2, min: -1, max: 1 },
  { key: 'overshoot', default: 0.5, min: -1, max: 1 },
  { key: 'raggedness', default: 0.5, min: 0, max: 1 },
  { key: 'strokeLength', default: 1, min: 0, max: 1 },
] as const

/** Graphite at a pressure, as a power of two. Above the matched 0.5, each 0.5 doubles it. Below,
 * it falls away faster, to an eighth at 0, the lightest touch: the slope is the same at 0.5. */
function pressedExponent(pressure: number) {
  const light = Math.max(0, 0.5 - pressure)
  return 2 * (pressure - 0.5) - 8 * light * light
}

/** How much of the tooth fill the lightest touch loses. */
const TOOTH_SKIM = 0.5
/** How much of the unfilled tooth the heaviest touch fills. */
const TOOTH_PRESS = 0.3

/** Where hatching strokes end. Overshoot sets the furthest any stroke runs past the shape;
 * raggedness makes lanes stop short of that by different amounts, and roughens the cut-off line
 * inwards, so it never pushes the edge further out. Below overshoot 0.25 the cut-off moves inside
 * the shape: at 0 the furthest ends sit under the outline, and at -1 they stop well short of it. */
function strokeEnds(overshoot: number, raggedness: number) {
  const reach = 16 * Math.max(0, overshoot)
  const short = Math.max(-8, reach - 8 * raggedness)
  return {
    endReach: [Math.min(short, reach - 0.01), reach] as const,
    // Below 0, the strokes stop short of the line and leave a rim of bare paper inside it.
    inset:
      overshoot < 0
        ? 2.5 - 4 * overshoot
        : 2.5 * Math.max(0, 1 - 4 * overshoot),
    raggedEnds: 1.5 * raggedness,
  }
}

/** Curvature at arc 1: a pivot radius of 1000 field units, about one and a half artwork widths. */
const MAX_ARC = 0.001

/** Linear luminance of the default colour, #36352e. Each grade's tuned colour is folded into its
 * darkness relative to this, so the default colour shows every grade at its matched tone. */
const DEFAULT_LUMINANCE = 0.0352

function onCurve(
  points: readonly (readonly [number, number])[],
  grade: number,
) {
  for (let i = 1; i < points.length; i++) {
    const [g1, v1] = points[i]
    if (grade <= g1) {
      const [g0, v0] = points[i - 1]
      return v0 + ((v1 - v0) * (grade - g0)) / (g1 - g0)
    }
  }
  return points[points.length - 1][1]
}

/** Paper, shared by every layer: 0 (smooth) to 1 (rough). 0.5 is the paper the grades were
 * matched on. */
export const paperSetting = {
  key: 'paper',
  default: 0.5,
  min: 0,
  max: 1,
} as const

/** How readily a grade's graphite fills the tooth of the chosen paper: rough paper has a larger
 * tooth that fills less readily, smooth paper the reverse. */
function paperFill(toothFill: number, paper: number) {
  return Math.min(1, Math.max(0, toothFill - 0.4 * (paper - 0.5)))
}

/** Internal shading values for the chosen settings. The defaults give the matched grade exactly. */
export function pencilShading(
  settings: Required<PencilSettings>,
  paper: number,
) {
  const {
    grade,
    pressure,
    density,
    wobble,
    width,
    arc,
    overshoot,
    raggedness,
    strokeLength,
  } = settings
  const at = (key: keyof typeof gradeCurves) => onCurve(gradeCurves[key], grade)
  const pencil = Object.fromEntries(
    (Object.keys(gradeCurves) as (keyof typeof gradeCurves)[])
      .filter((key) => key !== 'colorLuminance')
      .map((key) => [key, at(key)]),
  )
  const pressed = 2 ** pressedExponent(pressure)
  // Each step of 0.5 halves or doubles the line's width, from half at 0 to twice at 1.
  const blunt = 2 ** (2 * (width - 0.5))
  // Each step of 0.5 halves or doubles the stroke spacing.
  const spaced = 2 ** (-2 * (density - 0.5))
  // Wobble is how far lines stray from straight and evenly spaced: 0 rules them, 1 is a shaky
  // hand. Each line's own quick shake (its roughness) stops growing at the matched value; above
  // it the slow drift grows fast. Lines drift mostly on their own, so a shaky hand bunches some
  // and parts others, and paper shows where they part.
  const loose = 2 * wobble
  const lightness = Math.max(0, 1 - 2 * pressure)
  const heaviness = Math.max(0, 2 * pressure - 1)
  const fill = paperFill(at('toothFill'), paper)
  return {
    ...pencil,
    grainSize: grainSize(paper),
    // A light touch skims the paper's peaks and leaves its valleys bare; a heavy one presses
    // graphite down into them, so the paper's grain shows less.
    toothFill: Math.max(
      0,
      fill - TOOTH_SKIM * lightness + TOOTH_PRESS * heaviness * (1 - fill),
    ),
    darkness: Math.min(
      1,
      (at('darkness') * (1 - at('colorLuminance'))) / (1 - DEFAULT_LUMINANCE),
    ),
    load: Math.min(1, at('load') * pressed),
    strokeWidth: Math.min(4, at('strokeWidth') * blunt),
    strokeSpacing: Math.min(
      10,
      Math.max(1, sharedSettings.strokeSpacing * spaced),
    ),
    laneJitter: Math.min(0.8, sharedSettings.laneJitter * loose),
    // Above the matched hand the sway grows faster still, so wobble 1 is a really shaky hand.
    wander: sharedSettings.wander * loose ** 3 * (1 + Math.max(0, loose - 1)),
    tremor: sharedSettings.tremor * Math.min(1, loose),
    ...strokeEnds(overshoot, raggedness),
    handArc: MAX_ARC * arc,
    // From strokes 16 field units long at 0, each 0.2 doubles them, to 512 just below 1; at 1 the
    // hand never lifts.
    liftLength: strokeLength >= 1 ? 0 : 16 * 2 ** (5 * strokeLength),
  }
}

/** The thinnest and boldest outline pass, in field units. The default pass is 2.4 wide. */
const OUTLINE_HAIRLINE = 0.8
const OUTLINE_BOLD = 16.8

/** The outline's artist settings. */
export type PencilOutlineSettings = {
  /** Whole grades from -10 (10H) to 8 (8B), apart from the shading's. The grain follows the grade
   * as the shading's does; softer grades draw a darker, slightly wider line. The line's darkness
   * is not matched to real pencil. */
  grade?: number
  /** How hard the line is pressed, 0 to 1. 0 is the lightest touch. */
  pressure?: number
  /** How many lines the hand draws along the edge, 1 to 8. Each is its own line of the full
   * width and wobbles on its own: on top of each other they make the line darker, and with
   * wobble they drift apart into a sketchy bundle. */
  passes?: number
  /** How inaccurate each pass is, 0 (every pass close to the edge) to 1: each drifts off on its
   * own. On bold lines the drift grows with the width. */
  wobble?: number
  /** How wide each pass's line is, 0 (a hairline) to 1 (a bold line about seven default lines
   * wide): how blunt the point is. */
  width?: number
  /** How many light lines the hand draws to feel for the edge before it firms the line up, 0 to
   * 20. 0 draws only the firm line. */
  searchingLines?: number
  /** How hard the searching lines press, 0 (they leave no mark) to 1 (as firm as one pass of
   * the line at the default pressure). It has its own curve, not the line's pressure curve. */
  searchingPressure?: number
  /** How widely the searching strokes scatter around the final line, 0 to 1. Each short stroke
   * sits its own distance off the edge, the first lines furthest. 0 keeps them on it. */
  searchingSpread?: number
}

export const pencilOutlineSettings = [
  { key: 'grade', default: 0, min: -10, max: 8, integer: true },
  { key: 'pressure', default: 0.5, min: 0, max: 1 },
  { key: 'passes', default: 2, min: 1, max: 8, integer: true },
  { key: 'wobble', default: 0.5, min: 0, max: 1 },
  { key: 'width', default: 0.1, min: 0, max: 1 },
  { key: 'searchingLines', default: 6, min: 0, max: 20, integer: true },
  { key: 'searchingPressure', default: 0.5, min: 0, max: 1 },
  { key: 'searchingSpread', default: 0.5, min: 0, max: 1 },
] as const

/** Internal outline values. HB at the default pressure and wobble is the shader's default line. */
export function pencilOutline(
  settings: Required<PencilOutlineSettings>,
  paper: number,
) {
  const {
    grade,
    pressure,
    passes,
    wobble,
    width,
    searchingLines,
    searchingPressure,
    searchingSpread,
  } = settings
  // Each pass's line width, in field units.
  const lineWidth = OUTLINE_HAIRLINE + (OUTLINE_BOLD - OUTLINE_HAIRLINE) * width
  const at = (key: keyof typeof gradeCurves) => onCurve(gradeCurves[key], grade)
  return {
    // The line's grain comes from its own grade, as the shading's does, so the outline never
    // depends on the shading's settings.
    toothFill: paperFill(at('toothFill'), paper),
    edgeSoftness: at('edgeSoftness'),
    grainStretch: at('grainStretch'),
    speckle: at('speckle'),
    // Six grades softer doubles the darkness. Pressure follows the shading's curve.
    darkness: Math.min(3, 2 ** (grade / 6 + pressedExponent(pressure))),
    // The same pressure fills the paper's tooth as the shading's does.
    press:
      TOOTH_PRESS * Math.max(0, 2 * pressure - 1) -
      TOOTH_SKIM * Math.max(0, 1 - 2 * pressure),
    // The shader's width 1 is a pass 2.4 field units wide. Softer grades draw a little wider.
    lineWidth: (lineWidth / 2.4) * (1 + 0.03 * grade),
    // At wobble 1 a pass strays up to about 5.5 field units, or half the line on a bolder line,
    // so bold lines drift apart as visibly as thin ones.
    spread:
      (wobble <= 0.5 ? 2 * wobble : 0.5 + wobble) * Math.max(1, lineWidth / 11),
    passCount: passes,
    searchCount: searchingLines,
    exploratoryDensity: searchingPressure,
    // At 1 a searching line strays up to 28 field units, about 4% of the artwork's width.
    searchStray: 28 * searchingSpread,
  }
}
