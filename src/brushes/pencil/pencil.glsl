// @brush pencil
// Graphite pencil, matched to real 10H-8B shading, drawn as separate strokes. The outline is
// drawn with the same pencil along the artwork's paths.
// @param outline.opacity            float 0.9     0..1     Completed outline opacity
// @param outline.press              float 0       -1..1    How the line's pressure changes the paper's fill: below 0 a light touch skims the peaks, above 0 a heavy one fills the valleys
// @param outline.passCount          float 2       1..8     Number of firm passes; the renderer builds them, not the shader
// @param outline.darkness           float 1       0..3     How hard the firm passes press; 0 hides the outline
// @param outline.lineWidth          float 1       0.1..10  Width of one pass of the pencil line
// @param outline.spread             float 1       0..3     How far the firm passes stray from the path; 0 traces it
// @param outline.exploratoryDensity float 0.5     0..1     How hard the faint searching lines press
// @param outline.searchStray        float 14      0..40    Largest stray of a searching line from the path, in field units
// @param outline.searchCount        float 6       0..20    Number of searching lines; the renderer builds them, not the shader
// @param outline.toothFill          float 0.715   0..1     The line's grade: 0 marks only the paper's peaks; 1 fills its valleys evenly
// @param outline.edgeSoftness       float 0.0701  0..1     The line's grade: 0 gives crisp edges, 1 soft ones
// @param outline.grainStretch       float 1.2999  0.5..8   The line's grade: how far the tooth streaks along the line
// @param outline.speckle            float 0.5521  0..1     The line's grade: share of the tooth that is round speckle rather than streaks
//
// Shading: layer and lanes
// @param shading.opacity            float 1       0..1     Completed shading opacity
// @param shading.liftLength         float 0       0..600   How far the hand draws along a line before it lifts and starts a new stroke, in field units (0: never lifts)
// @param shading.angle              float 45      0..180   Hatching direction in degrees, counter-clockwise from horizontal
// @param shading.strokeSpacing      float 2.5758  1..10    Distance between stroke centres, in field units
// @param shading.endReach           range 1,7     -8..16   How far each lane's strokes run past the shape, in field units (negative stops short)
// @param shading.inset              float 0       0..9     Moves the cut-off inside the shape, in field units, so ends tuck under the outline
// @param shading.raggedEnds         float 1       0..2     How unevenly the shape cuts strokes off (0: along one smooth line)
// @param shading.darkness           float 0.3222  0..1     Darkest tone the graphite can reach
//
// Shading: the hand (where lines go, how hard they are pressed)
// @param shading.load               float 0.2816  0..1     Mean graphite load of a stroke (the pressure setting scales it)
// @param shading.pressureVariation  float 0.138   0..1     How much the load changes along and between strokes
// @param shading.strokeContrast     float 0.1034  0..1     How much darker some strokes are than their neighbours (hard grades: a few dark, many faint)
// @param shading.grouping           float 0.1842  0..1     Neighbouring strokes share darkness and sit closer together, merging into bands (0: each line on its own)
// @param shading.handArc            float 0.0002  -0.004..0.004 Curvature of the hatching lines, 1 / pivot radius in field units; negative bends the other way (the wrist pivots, so all strokes arc together)
// @param shading.wander             float 0.0798  0..2     Slow sideways drift of a hatching line
// @param shading.tremor             float 0.5     0..2     Small quick sideways shakes along a line (hand tremor)
// @param shading.laneJitter         float 0.4221  0..0.8   Uneven spacing between hatching lines, in stroke spacings
//
// Shading: the pencil (stroke shape and what the lead leaves behind)
// @param shading.strokeWidth        float 0.7617  0.2..4   Stroke half width, in field units
// @param shading.edgeSoftness       float 0.0701  0..1     0 gives crisp stroke edges, 1 soft ones
// @param shading.strokeGaps         float 0       0..0.7   Chance a hatching lane is left empty (never two side by side), leaving clean paper lines
// @param shading.scratches          float 0.1864  0..1     Fine parallel scratch lines from grit in the lead (hard grades read as dense fine streaks)
// @param shading.scratchSpacing     float 0.701   0.4..4   Distance between scratch lines, in field units
// @param shading.dust               float 0.0172  0..1     Sparse graphite specks on the highest paper peaks near strokes (hard grades)
//
// Shading: the paper (the paper setting drives grainSize and toothFill)
// @param shading.grainSize          float 1       0.5..2   Paper tooth size, in field units
// @param shading.toothFill          float 0.715   0..1     0 marks only the paper's peaks; 1 fills its valleys evenly
// @param shading.grainStretch       float 1.2999  0.5..8   How far the tooth streaks along the strokes
// @param shading.speckle            float 0.5521  0..1     Share of the tooth that is fine, round speckle rather than streaks
//
// The shading is drawn in three steps, each its own shader below:
//   1. The hand (GRAPHITE_STROKE_VERTEX). Every hatching line is a row of short strokes. The hand
//      places each stroke as a thin ribbon: where it starts, how it wanders and shakes, how hard it
//      presses, and where the shape cuts it off.
//   2. The pencil (GRAPHITE_STROKE_FRAGMENT). Draws one stroke from its own coordinates only:
//      how far along it is and how far from its centre line. It leaves graphite only in the
//      stroke: paper shows wherever strokes don't reach. Strokes pile up in a buffer in any order.
//   3. The paper (brushShading). Presses the piled-up graphite onto the paper tooth, then adds
//      the extras (scratches, dust).
// The outline uses the same pencil: a second hand (GRAPHITE_STROKE_PATH_VERTEX) follows the
// artwork's paths, its graphite piles up in its own channel, and brushOutline puts it on the paper.
// Each frame of the drawing animation adds only the strokes the hand draws in that frame.

// Fixed settings. Tuning against the real 10H-8B swatches gave these the same value for every
// grade, so they are part of the pencil, not settings. Lengths are in field units.
const float STROKE_LENGTH = 22.7225;   // One stroke along its lane.
const float GRAIN_COVER = 2.0;        // How much of one stroke's graphite it takes to hide the grain; higher shows grain deeper into it.
const float DEEP_PITS = 0.58;         // How much of the paper is deep pits that only pressure fills, at no tooth fill.
const float PIT_DEPTH = 0.45;         // How much of the paper stays light under thin graphite, at no tooth fill.
const float VALLEY_CATCH = .3;        // Share of the graphite a valley still catches.
const float CAUGHT_GRAIN = .5;        // How unevenly the graphite lies where the tooth catches it.
const float FLECKS = 1.2;             // How much bare paper the tooth leaves under a light touch.
const float FLECK_CATCH = .3;         // Share of the graphite a fleck still catches: the point smears a little into it.
const float FLECK_EDGE = .1;         // How gradually a fleck's edge fills, in tooth height.
const float LAYER_CEILING = 1.3;      // Darkest that stacked strokes get, as a multiple of one stroke's load.
const float STROKE_TILT = .0227;       // Angle difference between strokes, in radians.
const float BREAK_LENGTH = 51.4523;    // Distance over which the load changes along a stroke.
const float PRESSURE_GROUP = 4.8303;   // Neighbouring lanes that share a similar pressure.
const float PRESSURE_SWING = 3.0;     // A hand shading a drawing changes its pressure more than on a matched swatch.
const float CLUMPS = .5473;            // Strength of long bands of harder pressure.
const float BURNISH = .8;             // Share of the bare tooth left open by each further pass over the same spot.
const float OUTLINE_PASS = .6;        // Graphite one firm pass of the outline lays.
const float OUTLINE_WIDTH = 1.2;      // Half-width of one pass of the outline at width 1, in field units.
const float SEARCH_GAPS = .25;        // Share of searching strokes left out.
const float OUTLINE_PRESSURE_VARIATION = .35; // How much the outline's pressure changes along a pass.
const float CLUMP_SIZE = 4.0;          // Width of such a band across the strokes.
const float CLUMP_LENGTH = 8.3096;     // Its length along the strokes, as a multiple of its width.
const float HAND_GROUP = 6.0;          // Neighbouring lanes that drift together.
const float ZIGZAG = 1.0;              // 1 shades in back-and-forth sweeps, turning at each end; 0 in separate lines.
const float SWEEP_LENGTH = 120.0;      // Length of one sweep of the zigzag, along the strokes.
const float SWEEP_BAND = 40.0;         // Width of a band of lanes that share their sweeps.
const float LIFT_TAPER = 16.0;         // Longest taper at each end of a stroke, in field units.
const float HAND_SHARE = .3;           // Share of the drift those lanes have in common.

/** Two partial coverages on top of each other: each covers part of what the other leaves. */
float cover(float a, float b) {
  return 1.0 - (1.0 - a) * (1.0 - b);
}

/** Gradient noise, about 0-1. Smoother than the prelude's value noise, so magnified tooth does
 * not show square cells. */
float toothNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a00 = hash(i) * 6.2832, a10 = hash(i + vec2(1, 0)) * 6.2832;
  float a01 = hash(i + vec2(0, 1)) * 6.2832, a11 = hash(i + vec2(1, 1)) * 6.2832;
  float n00 = dot(vec2(cos(a00), sin(a00)), f);
  float n10 = dot(vec2(cos(a10), sin(a10)), f - vec2(1, 0));
  float n01 = dot(vec2(cos(a01), sin(a01)), f - vec2(0, 1));
  float n11 = dot(vec2(cos(a11), sin(a11)), f - vec2(1, 1));
  return .5 + .7 * mix(mix(n00, n10, u.x), mix(n01, n11, u.x), u.y);
}

/** Paper height at a position, 0 (valley) to 1 (peak). `across_along` is in stroke coordinates,
 * so `stretch` streaks the tooth along the strokes. Built from noise octaves sized in field units.
 * The tooth never gets finer than about two screen pixels: on small renders it grows to stay
 * visible, and octaves below that size drop out with the rest reweighted, so it never aliases
 * and looks alike on every screen. `pixel` is the screen pixel size in field units. */
float paperHeight(vec2 across_along, float stretch, float pixel) {
  float size = max(shading_grainSize, 2.0 * pixel);
  vec2 q = across_along / vec2(size, size * stretch);
  float height = 0.0;
  float weight = 0.0;
  float amplitude = 1.0;
  float scale = 1.0;
  for (int octave = 0; octave < 5; octave++) {
    // Drop an octave as its features shrink from two screen pixels to 1.4 (near Nyquist).
    float resolved = 1.0 - smoothstep(.5, .7, pixel * scale / size);
    // Each octave is rotated, so the noise lattice never lines up into a visible grid.
    float turn = float(octave) * 1.17;
    vec2 r = mat2(cos(turn), sin(turn), -sin(turn), cos(turn)) * (q * scale);
    height += amplitude * resolved * toothNoise(r + float(octave) * 17.3);
    weight += amplitude * resolved;
    amplitude *= .6;
    scale *= 2.03;
  }
  return smoothstep(.2, .8, height / max(weight, 1e-4));
}

/** One octave of noise at a frequency, faded to its mean where it is finer than about two pixels,
 * so detail the screen cannot show averages out to grey instead of flickering as salt and pepper. */
float resolvedNoise(vec2 q, float frequency, float pixel) {
  return mix(noise(q * frequency), .5, smoothstep(.25, .5, pixel * frequency));
}

/** The paper's grain: where thin graphite catches and where it leaves bare paper, 0-1. Three
 * octaves of noise at the tooth size, so rougher paper gives coarser grain. `pixel` is the size of
 * one output pixel in field units. */
float paperGrain(vec2 p, float pixel) {
  vec2 q = p / shading_grainSize;
  float px = pixel / shading_grainSize;
  return resolvedNoise(q, 2.7, px) * .55 + resolvedNoise(q, .83, px) * .3 + resolvedNoise(q, 6.1, px) * .15;
}

/** One pixel in hatching coordinates. */
struct Hatch {
  vec2 direction;  // Unit vector along the strokes (y down).
  float across;    // Position across the strokes, bent by handArc.
  float along;     // Position along the strokes.
  float pixel;     // Field units per screen pixel.
};

Hatch hatchAt(vec2 p, float angle, float handArc) {
  float a = radians(angle);
  Hatch h;
  h.direction = vec2(cos(a), -sin(a));
  vec2 normal = vec2(-h.direction.y, h.direction.x);
  h.along = dot(p, h.direction);
  // The wrist pivots, so every hatching line is part of one family of parallel arcs around the
  // middle of the artwork (a parabola, close to a circle of radius 1 / handArc near the middle).
  float fromMiddle = h.along - dot(uFieldSize * .5, h.direction);
  h.across = dot(p, normal) + .5 * handArc * fromMiddle * fromMiddle;
#if !defined(GRAPHITE_STROKE_VERTEX) && !defined(GRAPHITE_STROKE_PATH_VERTEX)
  h.pixel = length(fwidth(p)) * .7;  // Fragment shaders only: the hand has no pixels.
#endif
  return h;
}
Hatch shadingHatch(vec2 p) { return hatchAt(p, shading_angle, shading_handArc); }
/** The outline's grain has its own fixed direction, so the shading's angle and arc leave the
 * line alone. */
const float OUTLINE_GRAIN_ANGLE = 45.0;
Hatch outlineHatch(vec2 p) { return hatchAt(p, OUTLINE_GRAIN_ANGLE, 0.0); }

/** Slow sideways drift of lane `id` at `t` along it, about 0-1. Mostly each lane's own, with a
 * little of a smooth field that neighbouring lanes share (HAND_SHARE). */
float handDrift(float id, float t) {
  float shared = noise(vec2(id / HAND_GROUP, t));
  float own = noise(vec2(id * 2.1, t));
  return mix(own, shared, HAND_SHARE);
}

/** One hatching line, the same along its whole length at this position. */
struct Lane {
  float id;      // Lane index across the hatching.
  float load;    // Graphite load, 0-1; 0 for an empty lane.
  float offset;  // Sideways shift of the lane centre.
  vec2 overshoot; // How far the lane's strokes run past the shape, along them.
  float ragged;   // Uneven ends: added to the distance into the shape.
};

Lane laneAt(Hatch h, float id) {
  Lane lane;
  lane.id = id;
  float spacing = shading_strokeSpacing;

  // Pressure. The load changes along the lane over BREAK_LENGTH. A hand's pressure drifts slowly,
  // so nearby lanes share most of it (`group`, a smooth field over lane index); a little is per lane.
  float drift = noise(vec2(id * 1.7, h.along / BREAK_LENGTH)) * 2.0 - 1.0;
  float group = noise(vec2(id / PRESSURE_GROUP, 29.0));
  float own = .65 * (group * 2.0 - 1.0) * 1.6 + .35 * (hash(vec2(id, 29.0)) * 2.0 - 1.0);
  float load = shading_load * (1.0 + PRESSURE_SWING * shading_pressureVariation * (.75 * drift + .45 * own));

  // Contrast. Hard leads skip over the tooth unless pressed hard, so a few lanes come out dark
  // and most stay faint: a skewed spread with a mean of 1, 0.3 + 2.8u^3. With `grouping`, the dark
  // lanes are the ones where `group` peaks, so neighbours share darkness instead of a lone line.
  float u = mix(hash(vec2(id, 233.0)), group, shading_grouping);
  load *= mix(1.0, .3 + 2.8 * u * u * u, shading_strokeContrast);

  // Empty lanes run the full length, like the clean white lines in real hatching. Only a lane
  // whose draw is lower than both neighbours' can be empty, so two empty lanes never touch.
  float gapDraw = hash(vec2(id, 151.0));
  float empty = step(gapDraw, shading_strokeGaps)
    * step(gapDraw, hash(vec2(id - 1.0, 151.0))) * step(gapDraw, hash(vec2(id + 1.0, 151.0)));
  lane.load = clamp(load, 0.0, 1.0) * (1.0 - empty);

  // Placement. With grouping, lanes move up the group field's slope, so they bunch where it peaks
  // and leave wider gaps where it dips. laneJitter spaces lanes unevenly; wander is a slow drift
  // along the lane and tremor a quicker shake of each line on its own. The same hand draws
  // neighbouring lines moments apart, so they share a little of their drift; the rest is each
  // line's own, so a shaky hand bunches some lines and parts others.
  float slope = noise(vec2((id + 1.0) / PRESSURE_GROUP, 29.0)) - noise(vec2((id - 1.0) / PRESSURE_GROUP, 29.0));
  lane.offset = shading_grouping * clamp(slope * PRESSURE_GROUP, -1.0, 1.0) * .6 * spacing
    + (hash(vec2(id, 241.0)) - .5) * shading_laneJitter * spacing
    + (handDrift(id, h.along * .018) - .5) * 12.0 * shading_wander
    + (noise(vec2(id + 37.0, h.along * .045)) - .5) * 3.0 * shading_tremor;

  // Ends. Each lane runs past the shape by its own amount, or stops short of it (a negative
  // amount moves its cut-off inside). The ragged cut-off only ever pulls ends back.
  float reach = mix(shading_endReach.x, shading_endReach.y, hash(vec2(id, 71.0)));
  lane.overshoot = h.direction * max(reach, 0.0);
  lane.ragged = min(reach, 0.0) - noise(vec2(id * 1.3, h.along * .023)) * 5.5 * shading_raggedEnds;
  return lane;
}


#if defined(GRAPHITE_STROKE_VERTEX)
// 1. The hand. Each stroke is a ribbon: quads between SECTIONS + 1 points along the stroke, wide
// enough for the dust a loaded line sheds beside it.
const int SECTIONS = 8;
uniform float uLaneStart;      // First lane drawn.
uniform int uStrokesPerLane;   // Strokes per pass of each lane.
uniform float uStrokeStart;    // Index of each lane's first stroke.
uniform sampler2D uFar;        // How far each point is from the shape's near zone, /255 field units.
uniform float uCullMargin;     // A stroke whose centre stays further than this leaves no graphite.
uniform vec2 uShadingWindow;   // This frame draws the strokes the hand draws after x, up to y.

out vec2 vStroke;      // x: 0 at the stroke's start, 1 at its end. y: offset from its centre line.
out vec2 vPoint;       // Position in field units.
out float vLoad;       // Graphite load of the stroke here, before the pencil's own fade.
out float vLaneLoad;   // Load of the whole line, for dust.
out vec2 vOvershoot;   // Where the shape cuts the stroke off: see Lane.
out float vRagged;
out float vOutline;    // 1 for an outline stroke: its graphite goes to its own channel.
out float vWidth;      // Half-width of the pencil line, before pressure.
out vec2 vWindow;      // The frame's window minus when the hand draws this point.

/** Field position of a point given in hatching coordinates: the inverse of hatchAt. */
vec2 fieldPoint(Hatch h, float across) {
  vec2 normal = vec2(-h.direction.y, h.direction.x);
  float fromMiddle = h.along - dot(uFieldSize * .5, h.direction);
  return h.along * h.direction + (across - .5 * shading_handArc * fromMiddle * fromMiddle) * normal;
}

/** When the hand draws the point `t` along a stroke whose start, middle and end have these shading
 * orders. The pencil runs from the earlier end to the later one. A stroke that crosses from one
 * scheduled pass into another is drawn whole at its earliest time. */
float strokeTime(float order[3], float t, float jitter) {
  float first = 1.0;
  for (int i = 0; i <= 2; i++)
    if (order[i] < .999) first = min(first, order[i]);
  float a = order[0] < .999 ? order[0] : first;
  float b = order[2] < .999 ? order[2] : first;
  // Spread strokes out within one step of the 8-bit order, so they don't appear in clumps.
  float time = abs(b - a) < .004 ? mix(a, b, t) : first;
  return time + jitter / 255.0;
}

void main() {
  // One instance is one lane: all its strokes, each SECTIONS quads of two triangles.
  float id = uLaneStart + float(gl_InstanceID);
  int quad = gl_VertexID / 6;
  int corner = gl_VertexID - quad * 6;
  int within = quad / SECTIONS;
  int section = quad - within * SECTIONS + ((corner == 1 || corner == 2 || corner == 4) ? 1 : 0);
  int pass = within - (within / 2) * 2;
  float stroke = uStrokeStart + float(within / 2);
  float t = float(section) / float(SECTIONS);
  float side = (corner == 0 || corner == 1 || corner == 3) ? -1.0 : 1.0;

  // Two series of strokes per line, half a stroke apart, so their ends never line up.
  Hatch h;
  float a = radians(shading_angle);
  h.direction = vec2(cos(a), -sin(a));
  float start = stroke - float(pass) * .5 - hash(vec2(id, 43.0));
  h.along = (start + t) * STROKE_LENGTH;
  float strokeId = stroke * 2.0 + float(pass);

  // Where the line is here, plus this stroke's own small tilt and pressure.
  float spacing = shading_strokeSpacing;
  float tilt = (hash(vec2(id, strokeId + 223.0)) - .5) * 2.0 * STROKE_TILT;
  float pressure = 1.0 + shading_pressureVariation * .5 * (hash(vec2(id, strokeId + 227.0)) * 2.0 - 1.0);
  Lane lane = laneAt(h, id);
  float centre = (id + .5) * spacing + lane.offset + tilt * (t - .5) * STROKE_LENGTH;

  // Zigzag: the pencil goes back and forth without lifting. Each sweep moves one spacing across as
  // it runs along, the next comes back the other way, and the two meet at the turn, so a thin
  // wedge of paper opens between them towards the other end. Neighbouring lanes share their sweeps
  // in bands SWEEP_BAND wide, staggered so the turns don't line up across the shape. The stroke's
  // middle decides its sweep, so it stays whole.
  float middle = (start + .5) * STROKE_LENGTH;
  float band = floor(((id + .5) * spacing) / SWEEP_BAND);
  float stagger = hash(vec2(band, 307.0)) * SWEEP_LENGTH;
  float sweepIndex = floor((middle + stagger) / SWEEP_LENGTH);
  float sweep = (h.along - (sweepIndex + .5) * SWEEP_LENGTH + stagger) / SWEEP_LENGTH;
  float way = mod(id + step(.5, hash(vec2(band, sweepIndex) + 319.0)), 2.0) * 2.0 - 1.0;
  centre += ZIGZAG * way * sweep * spacing;

  // The ribbon reaches as far as the widest stroke's dust.
  float reach = shading_strokeWidth * 1.25 * 2.5 + spacing + 1.0;
  vec2 point = fieldPoint(h, centre + side * reach);

  vStroke = vec2(t, side * reach);
  vPoint = point;
  vLoad = lane.load * pressure;
  vLaneLoad = lane.load;
  vOvershoot = lane.overshoot;
  vRagged = lane.ragged;
  vOutline = 0.0;
  vWidth = shading_strokeWidth;
  // The hand lifts about every liftLength along a line and starts the next stroke where the last
  // one ended, with some overlap. Each stroke lands light and narrow and thins out as it lifts, so
  // where two ends happen to fall short of each other, a short pointed sliver of paper opens.
  // Strokes vary in length and place, and each line lifts at its own places.
  if (shading_liftLength > 0.0) {
    float L = shading_liftLength;
    float u = h.along / L + hash(vec2(id, 91.0));
    float bare = 1.0;
    for (float k = floor(u) - 1.0; k <= floor(u) + 1.0; k++) {
      float middle = k + .5 + .3 * (hash(vec2(id, k + 101.0)) - .5);
      float half_ = L * (.45 + .3 * hash(vec2(id, k + 97.0)));
      float fromMiddle = abs(u - middle) * L;
      bare *= smoothstep(half_ - min(.6 * half_, LIFT_TAPER), half_, fromMiddle);
    }
    float taper = 1.0 - bare;
    vLoad *= taper;
    vWidth *= mix(.3, 1.0, taper);
  }
  gl_Position = vec4(point.x / uFieldSize.x * 2.0 - 1.0, 1.0 - point.y / uFieldSize.y * 2.0, 0.0, 1.0);

  // Skip a stroke far outside the shape: test its lane's place at its start, middle and end.
  // The same three points give the stroke its time in the drawing: the shading order of its start
  // and end (1 is outside the shape, where nothing is scheduled). Compute these samples
  // from the stroke start so roundoff cannot make vertices of one stroke disagree about culling.
  float nearest = 1e4;
  float order[3];
  for (int i = 0; i <= 2; i++) {
    Hatch at = h;
    at.along = (start + float(i) * .5) * STROKE_LENGTH;
    vec2 uv = fieldPoint(at, (id + .5) * spacing) / uFieldSize;
    nearest = min(nearest, texture(uFar, uv).r * 255.0);
    order[i] = texture(uField, uv).a;
  }
  if (nearest > uCullMargin) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  float jitter = hash(vec2(id, strokeId + 229.0));
  vWindow = uShadingWindow - strokeTime(order, t, jitter);
  // Skip a stroke drawn wholly before or after this frame.
  float first = min(strokeTime(order, 0.0, jitter), strokeTime(order, 1.0, jitter));
  float last = max(strokeTime(order, 0.0, jitter), strokeTime(order, 1.0, jitter));
  if (last <= uShadingWindow.x || first > uShadingWindow.y) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}

#elif defined(GRAPHITE_STROKE_PATH_VERTEX)
// 1b. The hand drawing the outline. Same pencil, but the strokes follow the artwork's paths
// (built in strokes.ts) instead of hatching lanes. `outline.spread` is how far the hand strays
// from the path: 0 traces it exactly.
const float OUTLINE_STRAY = 2.5;   // Largest slow stray from the path at spread 1, in field units.
const float OUTLINE_SHAKE = 1.2;   // Largest faster shake of a firm pass, in field units.
const float OUTLINE_TREMOR = .5;   // The hand's small quick shakes, as the shading's at wobble 0.5.
in vec2 aCentre;   // Point on the path.
in vec2 aNormal;   // Unit normal of the path there.
in vec4 aStroke;   // t along the stroke, side of the ribbon (-1 or 1), seed, distance along the path.
in vec4 aFaint;    // x: 0 for a firm pass, or 1 to 2 for a searching line by how sure it is. y: when the hand draws this point, 0 to 1.
                   // z: where its stroke starts along the path. w: how much the path bends here, 0-1.
in float aDown;    // How far the pencil is down: 1, or less near an open line's ends as it lands and lifts.

out vec2 vStroke;
out vec2 vPoint;
out float vLoad;
out float vLaneLoad;
out vec2 vOvershoot;
out float vRagged;
out float vOutline;
out float vWidth;
out vec2 vWindow;
uniform vec2 uOutlineWindow;   // This frame draws what the hand draws after x, up to y.

void main() {
  float t = aStroke.x, side = aStroke.y, seed = aStroke.z, along = aStroke.w;
  float faint = step(.5, aFaint.x);
  // The searching lines converge: the first is loosest and lightest, each later one surer.
  float passSure = clamp(aFaint.x - 1.0, 0.0, 1.0);
  // Each pass strays slowly from the path and shakes a little, like a hatching line's wander and
  // tremor; the passes stray differently, so together they make a loose bundle.
  float firmStray = (noise(vec2(seed * 1.7, along * .02)) - .5) * 2.0 * OUTLINE_STRAY * outline_spread;
  // Searching lines: the light lines an artist draws while finding the shape. Each is a short
  // stroke that sits its own distance off the path and drifts across it a little, with some drift
  // shared along the pass; some strokes are left out. They sit a little outside the path.
  float outward = sign(fieldDistance((aCentre - aNormal) / uFieldSize) - fieldDistance((aCentre + aNormal) / uFieldSize));
  float strokeStart = aFaint.z;
  float own = hash(vec2(seed * 7.1, strokeStart)) - .5, slant = hash(vec2(seed * 3.3, strokeStart + 11.0)) - .5;
  float off = (.7 * own + .3 * (noise(vec2(seed * 1.9, along * .019)) - .5)) * 2.0 * mix(1.3, .55, passSure);
  // Where the edge bends the hand is less sure, so the lines stray further.
  float searching = (off + slant * .5 * (t - .5)) * outline_searchStray * mix(.8, 1.25, aFaint.w)
    + outward * OUTLINE_WIDTH * outline_lineWidth;
  float stray = mix(firmStray, searching, faint)
    + (noise(vec2(seed + 37.0, along * .045)) - .5) * 3.0 * OUTLINE_TREMOR
    + (noise(vec2(seed + 71.0, along * .12)) - .5) * 2.0 * OUTLINE_SHAKE * outline_spread * (1.0 - faint);
  // Searching lines are felt for with the pencil's tip, so they keep a normal line's width
  // however thick the firm line is.
  // As the pencil lands and lifts at an open line's ends, it presses lighter and only its tip
  // touches, so the line tapers to a point.
  float down = smoothstep(0.0, 1.0, aDown);
  float width = OUTLINE_WIDTH * mix(outline_lineWidth, 1.0, faint) * mix(.25, 1.0, down);
  float reach = width * 1.25 * 2.5 + 3.6;
  vec2 point = aCentre + aNormal * (stray + side * reach);
  float drift = noise(vec2(seed * 1.3, along / BREAK_LENGTH)) * 2.0 - 1.0;
  // Each pass's pressure changes along the line and stays short of filling the paper, so the
  // line's width, tone and grain keep varying. A softer grade's darkness is added on the paper.
  // Searching lines press lighter by the same amount, so they keep their tone.
  // At searching pressure 1 a searching line presses as hard as a firm pass.
  float searchPressure = .6 * outline_exploratoryDensity * outline_exploratoryDensity;
  // The surer the hand, the closer a searching line comes to the edge and the harder it presses.
  float sure = 1.0 - min(1.0, abs(off));
  searchPressure *= (.4 + 1.2 * sure) * mix(.6, 1.3, passSure) * step(SEARCH_GAPS, hash(vec2(seed * 5.7, strokeStart + 23.0)));
  float pressure = mix(OUTLINE_PASS, searchPressure / max(outline_darkness, .01), faint);
  float load = clamp(pressure * (1.0 + OUTLINE_PRESSURE_VARIATION * drift) * mix(.3, 1.0, down), 0.0, 1.0);

  vStroke = vec2(t, side * reach);
  vPoint = point;
  vLoad = load;
  vLaneLoad = load;
  vOvershoot = vec2(0.0);
  vRagged = 100.0;  // The outline is not cut off by the shape.
  vOutline = 1.0;
  vWidth = width;
  vWindow = uOutlineWindow - aFaint.y;
  gl_Position = vec4(point.x / uFieldSize.x * 2.0 - 1.0, 1.0 - point.y / uFieldSize.y * 2.0, 0.0, 1.0);
}

#elif defined(GRAPHITE_STROKE_FRAGMENT)
// 2. The pencil. Draws one stroke. Output: r graphite in the stroke, b outline graphite, a how close
// a loaded line is (for dust). The renderer combines strokes as cover() for r and b, max for a.
in vec2 vStroke;
in vec2 vPoint;
in float vLoad;
in float vLaneLoad;
in vec2 vOvershoot;
in float vRagged;
in float vOutline;
in float vWidth;
in vec2 vWindow;

void main() {
  // Each frame adds only what the hand draws in its window: not later (x < 0) and not already
  // drawn (y >= 0). The cut is hard, so every point of a stroke is drawn in exactly one frame.
  if (vWindow.y < 0.0 || vWindow.x >= 0.0) discard;
  Hatch h = hatchAt(vPoint, mix(shading_angle, OUTLINE_GRAIN_ANGLE, vOutline), shading_handArc * (1.0 - vOutline));
  // Long bands of harder pressure across a few neighbouring strokes (a faint zebra banding).
  float clump = max(0.0, 1.0 + CLUMPS * 1.6
    * (toothNoise(vec2(h.across / CLUMP_SIZE, h.along / (CLUMP_SIZE * CLUMP_LENGTH)) + 17.0) - .5));
  // The stroke fades in and out along its length; heavier strokes press wider.
  float fade = sin(3.14159 * vStroke.x);
  // The two series of an outline lie on the same path, so their fades are matched in darkness
  // (covering one over the other gives vLoad everywhere), which keeps the line an even tone.
  float faded = mix(vLoad * fade * fade, 1.0 - pow(1.0 - min(vLoad, .99), fade * fade), vOutline);
  float load = faded * clump;
  float width = vWidth;
  // Pressing harder widens a hatching line in proportion. The outline's point is set by its
  // thickness, so pressure widens it by the same small amount however blunt the point is.
  // The outline is drawn as overlapping strokes whose fades cover each other evenly, so its width
  // follows the pass's pressure (vLoad), not the fade: otherwise it would pinch where they meet.
  float halfWidth = mix(width * (.75 + .5 * load), width + OUTLINE_WIDTH * (.5 * vLoad - .25), vOutline);
  // A light touch draws a narrower line, so faint searching lines stay thin.
  halfWidth *= mix(1.0, min(1.0, .35 + vLoad), vOutline);
  float d = abs(vStroke.y);
  // Cross-section: 1 inside, 0 outside, with a soft edge of at least most of a pixel.
  float soft = max(mix(shading_edgeSoftness, outline_edgeSoftness, vOutline) * halfWidth + .15, .75 * h.pixel);
  float profile = 1.0 - smoothstep(halfWidth - soft, halfWidth + soft, d);
  float spread = 1.0 - smoothstep(0.0, halfWidth * 2.5 + shading_strokeSpacing, d);
  // The shape cuts the stroke off, a little past its edge (or inside it, with inset) and raggedly.
  vec2 uv = vPoint / uFieldSize;
  float edge = max(fieldDistance(uv + vOvershoot / uFieldSize), fieldDistance(uv - vOvershoot / uFieldSize));
  // The field measures depth only to 16, so the cut-off never moves more than 12 inside.
  float inside = smoothstep(-1.3, .8, edge + max(vRagged - shading_inset, -12.0));
  // Graphite in the stroke goes to r (hatching) or b (outline, which presses harder).
  // The paper pass reads a as shading, so the outline leaves it alone: otherwise its dust would
  // show only when shading is on, as a fuzz around the line.
  float core = profile * load * inside;
  float hatching = 1.0 - vOutline;
  fragColor = vec4(core * hatching, 0.0, core * vOutline,
    vLaneLoad * spread * inside * hatching);
}

#else
// 3. The paper, and the outline. uStrokes holds the piled-up strokes for this pixel.
// Strokes are culled by their own farness map, so the paper is drawn wherever they reach.
uniform sampler2D uStrokes;

/** Scratches: grit in a hard lead drags long, fine, parallel lines through the graphite, so dense
 * hard-grade shading reads as many fine streaks. Returns a multiplier for the deposit, centred on
 * the typical value so the scratches move graphite around without changing the tone. */
float scratchFactor(Hatch h) {
  float cellWidth = shading_scratchSpacing;
  float cellId = floor(h.across / cellWidth);
  float scratch = 0.0;
  for (int k = -1; k <= 1; k++) {
    float cid = cellId + float(k);
    float x = (cid + hash(vec2(cid, 271.0))) * cellWidth;
    float hw = cellWidth * (.15 + .2 * hash(vec2(cid, 277.0)));
    float soft = max(hw * .5, .75 * h.pixel);
    float line = 1.0 - smoothstep(hw - soft, hw + soft, abs(h.across - x));
    float u = hash(vec2(cid, 281.0));
    float strength = u * u * (.5 + noise(vec2(cid * 1.9, h.along / 25.0)));
    scratch = max(scratch, line * strength);
  }
  return 1.0 + shading_scratches * 2.5 * (scratch - .12);
}

/** Share of a deposit that lands on a bit of tooth at `height`, below a waterline. Flecks below
 * it catch only FLECK_CATCH; the graphite they miss lands on the peaks instead, so the average
 * tone is that of the matched swatches (about `waterline` of the paper bare, holding a tenth).
 * Where the tooth is finer than a pixel (`resolved` below 1) the pixel shows that average. */
float flecked(float waterline, float height, float resolved) {
  float tone = 1.0 - .9 * waterline;
  float caught = mix(FLECK_CATCH, 1.0, smoothstep(waterline - FLECK_EDGE, waterline + FLECK_EDGE, height));
  return tone * mix(1.0, caught / (1.0 - (1.0 - FLECK_CATCH) * waterline), resolved);
}

/** The paper's tooth under a deposit: streaks along the strokes where the tooth shows strongly
 * (high grainStrength), round speckle where it is weak. The round tooth belongs to the paper, so
 * it sits in page coordinates: layers drawn at different angles catch on the same peaks. */
float toothAt(Surface s, Hatch h, float grainStrength, float roundTooth, float speckle, float stretch) {
  float speckleShare = clamp(speckle * (1.5 - grainStrength), 0.0, 1.0);
  float tooth = mix(paperHeight(vec2(h.across, h.along), stretch, h.pixel), roundTooth, speckleShare);
  // Where the tooth is finer than about two pixels, each pixel covers several peaks and valleys
  // and shows their average, so the tooth's contrast fades instead of showing as a speckle.
  return .5 + (tooth - .5) * min(1.0, shading_grainSize / (2.0 * h.pixel));
}

float brushShading(Surface s) {
  Hatch h = shadingHatch(s.p);
  vec4 strokes = texelFetch(uStrokes, ivec2(gl_FragCoord.xy), 0);
  float load = clamp(strokes.r, 0.0, 1.0);
  float dustNear = strokes.a;
  // Stacked strokes darken less and less: once the paper's peaks are full, the point slides over
  // the graphite already there. One stroke keeps its own load; the pile levels off at the ceiling.
  float ceiling = min(1.0, shading_load * LAYER_CEILING);
  float knee = shading_load / LAYER_CEILING;
  if (load > knee) load = knee + (ceiling - knee) * (1.0 - exp(-(load - knee) / max(ceiling - knee, 1e-3)));

  // 3. Paper tooth: graphite catches the paper's peaks and skips its valleys. Each bit of tooth
  // either catches or stays light: below a waterline the paper shows as soft flecks. A lighter
  // touch leaves the waterline higher, so the flecks gather where the hand pressed lightly; a
  // tooth that fills readily (more pressure, smooth paper) lowers it.
  float grainStrength = (1.0 - shading_toothFill) * (1.0 - load * load);
  float roundTooth = paperHeight(s.p + 53.0, 1.0, h.pixel);
  float tooth = toothAt(s, h, grainStrength, roundTooth, shading_speckle, shading_grainStretch);
  float waterline = FLECKS * (1.0 - shading_toothFill) * (1.0 - min(load, 1.0));
  // toothAt fades the tooth where it is finer than a pixel; undo that to find each bit's height,
  // and blend to the average cover (bare paper is the share below the waterline) by the same amount.
  float resolved = min(1.0, shading_grainSize / (2.0 * h.pixel));
  float height = .5 + (tooth - .5) / max(resolved, .05);
  float deposit = load * flecked(waterline, height, resolved);
  // Where graphite does catch, higher peaks take more of it than lower ones, so it has a grain too.
  deposit = clamp(deposit * (1.0 + CAUGHT_GRAIN * 4.0 * grainStrength * (tooth - .5)), 0.0, 1.0);
  // Where graphite lies thin, at a stroke's edge or a light touch, it catches only the paper's
  // high points and the low ones stay bare, so the paper shows through as grain. Where it lies
  // thick it fills the paper. The more readily the tooth fills (a softer grade, more pressure,
  // smoother paper), the less bare paper shows. Stacking strokes does not fill the paper's deepest
  // pits: every stroke skims the same peaks, so only pressing harder pushes graphite into them.
  // A valley still catches some graphite, so it shows lighter, not bare.
  float grain = paperGrain(s.p, h.pixel);
  float pitLevel = PIT_DEPTH * (1.0 - shading_toothFill);
  float deepLevel = DEEP_PITS * (1.0 - shading_toothFill);
  float oneStroke = min(deposit, shading_load);
  float valleys = mix(VALLEY_CATCH, 1.0, smoothstep(pitLevel - .1, pitLevel + .4, grain));
  deposit *= mix(valleys, 1.0, pow(oneStroke, GRAIN_COVER));
  deposit *= mix(VALLEY_CATCH, 1.0, smoothstep(deepLevel - .04, deepLevel + .12, grain));

  // 4. Extras.
  if (shading_scratches > 0.0) deposit = clamp(deposit * scratchFactor(h), 0.0, 1.0);
  // Dust: a hard lead sheds fine graphite that catches only on the highest peaks of the paper, so
  // the paper between hard-grade lines shows sparse grey specks, not a smooth wash.
  if (shading_dust > 0.0) {
    deposit = cover(deposit, shading_dust * min(1.0, 2.0 * dustNear) * smoothstep(.8, .92, roundTooth));
  }
  return shading_darkness * deposit;
}

/** The outline: the outline strokes' graphite (b), on the same paper. It is pressed harder, so it
 * reaches further towards black, and some tooth always shows through. */
float brushOutline(Surface s) {
  Hatch h = outlineHatch(s.p);
  float load = clamp(texelFetch(uStrokes, ivec2(gl_FragCoord.xy), 0).b, 0.0, 1.0);
  // About how many passes cover this spot: each lays OUTLINE_PASS, piled as cover.
  float passes = log(max(1.0 - load, 1e-3)) / log(1.0 - OUTLINE_PASS);
  // Passes over the same spot level off as the shading's strokes do.
  float ceiling = min(1.0, OUTLINE_PASS * LAYER_CEILING);
  float knee = OUTLINE_PASS / LAYER_CEILING;
  if (load > knee) load = knee + (ceiling - knee) * (1.0 - exp(-(load - knee) / max(ceiling - knee, 1e-3)));
  // The line's own pressure sets how readily the tooth fills, as the shading's pressure does for
  // the shading: a light touch skims the peaks, a heavy one presses into the valleys.
  float fill = clamp(outline_toothFill + (outline_press < 0.0 ? outline_press : outline_press * (1.0 - outline_toothFill)), 0.0, 1.0);
  const float minGrain = .5;
  float grainStrength = (1.0 - fill) * max(minGrain, 1.0 - load * load);
  float tooth = toothAt(s, h, grainStrength, paperHeight(s.p + 53.0, 1.0, h.pixel), outline_speckle, outline_grainStretch);
  // The same paper as the shading: below a waterline the tooth stays light. The line's thin edges,
  // where one pass barely touched, open up further. Each pass over the same spot mostly skims the
  // same peaks, but smears a little graphite into the valleys, so many passes slowly close them.
  float waterline = FLECKS * (1.0 - fill) * (1.0 - min(load, OUTLINE_PASS)) * pow(BURNISH, max(passes - 1.0, 0.0));
  float resolved = min(1.0, shading_grainSize / (2.0 * h.pixel));
  float height = .5 + (tooth - .5) / max(resolved, .05);
  float deposit = load * flecked(waterline, height, resolved);
  deposit = clamp(deposit * (1.0 + CAUGHT_GRAIN * 4.0 * grainStrength * (tooth - .5)), 0.0, 1.0);
  // A softer grade lays more graphite on each pass, darkening the line without flattening it.
  return 1.0 - pow(1.0 - deposit, outline_darkness);
}
#endif
