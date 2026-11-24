// Path line: strokes along the artwork's paths, in passes, with searching lines first.

/** Outline strokes along a path: their length. */
const OUTLINE_STROKE = 40
/** A searching line's strokes: long sweeps where the edge runs straight, shorter ones where it
 * bends, as the hand feels its way round a curve. */
const SEARCH_STROKE = [80, 30] as const
/** How straight a searching stroke runs, 0 (follows the edge) to 1 (a straight line along the
 * edge's direction at its middle). */
const SEARCH_STRAIGHT = 0.85
/** The turn, in radians within 8 field units, that counts as a corner the hand stops at. */
const CORNER_TURN = 0.7
/** How far either side of a point the path's bend is measured, in field units. */
const BEND_REACH = 10
/** Outline ribbons are sampled every field unit (one section per unit of stroke length) so they
 * keep to sharp corners, and turn their normal over CORNER_RADIUS either side, so the ribbon bends
 * round a corner instead of folding. */
const CORNER_RADIUS = 4
/** Where a path is open (a line, not a shape), the hand lands and lifts over this many field units
 * at each end, so the line tapers in and out instead of stopping square. */
const END_TAPER = 24
/** Floats per outline vertex: centre (2), path normal (2), stroke t, side, seed, distance along,
 * 1 for a faint searching line, when the hand draws this point (0 to 1), where its stroke starts
 * along the path, how much the path bends there (0 straight to 1 a tight curve), and how far the
 * pencil is down at an open end (0 lifted to 1). */
export const PATH_VERTEX_FLOATS = 13
/** Share of the outline's drawing time spent on the faint searching lines, which come first. */
const SEARCHING_SHARE = 0.28
/** The hand works round the outline a stretch about this long at a time, in field units. */
const STRETCH = 160

/** Ribbon vertices for the outline: each path drawn `firmPasses` times firmly and
 * `searchingLines` times faintly, each pass as two series of strokes half a stroke apart, like a
 * hatching line, but following the path. Both series of a pass share its seed, so they stray
 * together and the line stays continuous where one stroke fades into the next. The hand's stray
 * from the path is added in the shader. */
export function pathStrokes(
  paths: readonly (readonly { x: number; y: number }[])[],
  searchingLines: number,
  firmPasses = 2,
) {
  const OUTLINE_PASSES = firmPasses
  const out: number[] = []
  const lengthOf = (path: readonly { x: number; y: number }[]) =>
    path.reduce(
      (sum, p, i) =>
        i ? sum + Math.hypot(p.x - path[i - 1].x, p.y - path[i - 1].y) : 0,
      0,
    )
  const pathLengths = paths.map(lengthOf)
  const allPaths = pathLengths.reduce((a, b) => a + b, 0) || 1
  // The hand works round each path a stretch at a time, as an artist does: it searches for the
  // stretch's line with faint lines, back and forth, then firms it up, then moves on. `slot` is a
  // pass's share of its stretch's time.
  const searchingShare = searchingLines ? SEARCHING_SHARE : 0
  const slot = (pass: number) =>
    pass >= OUTLINE_PASSES
      ? {
          start: ((pass - OUTLINE_PASSES) * searchingShare) / searchingLines,
          duration: searchingShare / searchingLines,
        }
      : {
          start:
            searchingShare + (pass * (1 - searchingShare)) / OUTLINE_PASSES,
          duration: (1 - searchingShare) / OUTLINE_PASSES,
        }
  let pathOffset = 0
  paths.forEach((path, pathIndex) => {
    const offset = pathOffset
    pathOffset += pathLengths[pathIndex]
    if (path.length < 2) return
    const lengths = [0]
    for (let i = 1; i < path.length; i++)
      lengths.push(
        lengths[i - 1] +
          Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y),
      )
    const total = lengths[lengths.length - 1]
    if (total < 1) return
    const first = path[0],
      last = path[path.length - 1]
    const closed = Math.hypot(first.x - last.x, first.y - last.y) < 0.5
    const stretches = Math.max(1, Math.round(total / STRETCH))
    const stretchLength = total / stretches
    let segment = 0
    const pointAt = (distance: number) => {
      let d = closed ? ((distance % total) + total) % total : distance
      d = Math.min(total, Math.max(0, d))
      // Step back from the last segment rather than restart: bends and corners look behind.
      if (lengths[segment] > d)
        while (segment > 0 && lengths[segment] >= d) segment--
      while (segment < path.length - 2 && lengths[segment + 1] < d) segment++
      const a = path[segment],
        b = path[segment + 1]
      const span = lengths[segment + 1] - lengths[segment] || 1
      const f = (d - lengths[segment]) / span
      return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }
    }
    for (let pass = 0; pass < OUTLINE_PASSES + searchingLines; pass++) {
      const faint = pass >= OUTLINE_PASSES ? 1 : 0
      const seed = pathIndex * 101 + pass * 13
      // The searching lines converge: the first is the loosest, each later one surer, 0 to 1.
      const sure =
        faint && searchingLines > 1
          ? (pass - OUTLINE_PASSES) / (searchingLines - 1)
          : 1
      /** A repeatable random number, 0-1, for this pass at a distance along the path. */
      const chance = (along: number, salt: number) => {
        const x =
          Math.sin(seed * 12.9898 + along * 78.233 + salt * 37.719) * 43758.5453
        return x - Math.floor(x)
      }
      const { start: passStart, duration } = slot(pass)
      const backwards = faint && (pass - OUTLINE_PASSES) % 2 === 1
      const timeAt = (along: number) => {
        const d = closed
          ? ((along % total) + total) % total
          : Math.min(total, Math.max(0, along))
        const stretch = Math.min(stretches - 1, Math.floor(d / stretchLength))
        const within = d / stretchLength - stretch
        const f = backwards ? 1 - within : within
        const time = stretch + passStart + duration * f
        return (offset + stretchLength * time) / allPaths
      }
      // How much the path bends at a distance along it: the turn between the directions
      // BEND_REACH before and after, per unit length, eased from 0 (straight) to 1 (tight).
      const bendAt = (along: number) => {
        const p = pointAt(along),
          a = pointAt(along - BEND_REACH),
          b = pointAt(along + BEND_REACH)
        const ux = p.x - a.x,
          uy = p.y - a.y,
          vx = b.x - p.x,
          vy = b.y - p.y
        const turn =
          Math.abs(Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy)) /
          BEND_REACH
        const t = Math.min(1, Math.max(0, (turn - 0.004) / (0.06 - 0.004)))
        return t * t * (3 - 2 * t)
      }
      // A sharp corner: the path turns by more than CORNER_TURN within a few units.
      const isCorner = (along: number) => {
        const p = pointAt(along),
          a = pointAt(along - 4),
          b = pointAt(along + 4)
        const ux = p.x - a.x,
          uy = p.y - a.y,
          vx = b.x - p.x,
          vy = b.y - p.y
        return (
          Math.abs(Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy)) >
          CORNER_TURN
        )
      }
      // The hand lifts at a sharp corner and starts the next side afresh, so a searching stroke
      // ends just past one instead of running off it.
      // Each pass is its own movement of the hand: its strokes vary in length, looser passes
      // make shorter, choppier ones, and it lifts a little before or after a corner.
      const strokeLength = (start: number) => {
        if (!faint) return OUTLINE_STROKE
        const length = Math.round(
          (SEARCH_STROKE[0] +
            (SEARCH_STROKE[1] - SEARCH_STROKE[0]) *
              bendAt(start + SEARCH_STROKE[1] / 2)) *
            (0.55 + 0.5 * sure) *
            (0.75 + 0.5 * chance(start, 1)),
        )
        for (let along = start + 12; along < start + length - 4; along += 2)
          if (isCorner(along))
            return Math.max(
              8,
              Math.round(along - start - 4 + 10 * chance(start, 2)),
            )
        return Math.max(8, length)
      }
      const longest = faint ? SEARCH_STROKE[0] : OUTLINE_STROKE
      const phase = ((pass * 0.37) % 1) * longest
      for (let series = 0; series < 2; series++) {
        const start0 = phase + (series * longest) / 2 - longest
        for (
          let start = start0, length = strokeLength(start);
          start < total;
          start += length, length = strokeLength(start)
        ) {
          if (!closed && start + length <= 0) continue
          const directionAt = (along: number) => {
            const q = pointAt(along + CORNER_RADIUS),
              r = pointAt(along - CORNER_RADIUS)
            const n = Math.hypot(q.x - r.x, q.y - r.y) || 1
            return { x: (q.x - r.x) / n, y: (q.y - r.y) / n }
          }
          // A searching stroke is a sweep of the hand: it runs mostly straight along the edge's
          // direction at its middle, so round a curve it leaves the edge instead of circling it.
          const middle = start + length / 2
          const centre = pointAt(middle),
            heading = directionAt(middle)
          // Round a tight curve the hand follows it more closely, so no stroke flies off it.
          const straight = SEARCH_STRAIGHT * (1 - 0.7 * bendAt(middle))
          const section = (k: number) => {
            const t = k / length
            const along = start + t * length
            let p = pointAt(along),
              d = directionAt(along)
            if (faint) {
              const s = along - middle
              p = {
                x: p.x + (centre.x + heading.x * s - p.x) * straight,
                y: p.y + (centre.y + heading.y * s - p.y) * straight,
              }
              const dx = d.x + (heading.x - d.x) * straight,
                dy = d.y + (heading.y - d.y) * straight
              const n = Math.hypot(dx, dy) || 1
              d = { x: dx / n, y: dy / n }
            }
            const bend = faint ? bendAt(along) : 0
            const down = closed
              ? 1
              : Math.min(
                  1,
                  Math.max(0, Math.min(along, total - along) / END_TAPER),
                )
            return { p, nx: -d.y, ny: d.x, t, along, bend, down }
          }
          for (let k = 0; k < length; k++) {
            const a = section(k),
              b = section(k + 1)
            const corners: [typeof a, number][] = [
              [a, -1],
              [b, -1],
              [a, 1],
              [b, -1],
              [b, 1],
              [a, 1],
            ]
            for (const [c, side] of corners)
              out.push(
                c.p.x,
                c.p.y,
                c.nx,
                c.ny,
                c.t,
                side,
                seed,
                c.along,
                // 0 for a firm pass; 1 to 2 for a searching line, by how sure it is.
                faint ? 1 + sure : 0,
                timeAt(c.along),
                start,
                c.bend,
                c.down,
              )
          }
        }
      }
    }
  })
  return new Float32Array(out)
}
