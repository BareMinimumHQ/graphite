import { absolutize, normalize, parsePath } from 'path-data-parser'
import { svgPathProperties } from 'svg-path-properties'

export type Point = { x: number; y: number }

/** One continuous run of an SVG path, in the artwork's own coordinates. */
export type Subpath = {
  length: number
  /** Closed with `Z`, or a polygon. Closed subpaths repeat their first point at the end. */
  closed: boolean
  /** `divisions + 1` points evenly spaced along the subpath. */
  spacedPoints(divisions: number): Point[]
}

type Matrix = Pick<DOMMatrix, 'a' | 'b' | 'c' | 'd' | 'e' | 'f'>
const identity: Matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }

// Ellipse-arc-to-Bezier coefficient, inverted, for rounded rectangles.
const BEZIER_ARC = 1 - 0.551915024494

function multiply(m: Matrix, n: Matrix): Matrix {
  return {
    a: m.a * n.a + m.c * n.b,
    b: m.b * n.a + m.d * n.b,
    c: m.a * n.c + m.c * n.d,
    d: m.b * n.c + m.d * n.d,
    e: m.a * n.e + m.c * n.f + m.e,
    f: m.b * n.e + m.d * n.f + m.f,
  }
}

function subpath(d: string, closed: boolean): Subpath {
  const properties = new svgPathProperties(d)
  const length = properties.getTotalLength()
  return {
    length,
    closed,
    spacedPoints(divisions) {
      const points: Point[] = []
      for (let i = 0; i <= divisions; i++) {
        const { x, y } = properties.getPointAtLength((length * i) / divisions)
        points.push({ x, y })
      }
      return points
    },
  }
}

/** Splits path data into subpaths, with arcs and quadratics converted to cubic curves, then transformed. */
export function pathSubpaths(
  data: string,
  matrix: Matrix = identity,
  closeAll = false,
): Subpath[] {
  const map = (x: number, y: number) =>
    `${matrix.a * x + matrix.c * y + matrix.e} ${matrix.b * x + matrix.d * y + matrix.f}`
  const result: Subpath[] = []
  let start = '',
    d = '',
    drawn = false
  const finish = (closed: boolean) => {
    if (drawn) {
      const closesPath = closed || closeAll
      result.push(subpath(closesPath ? d + 'Z' : d, closesPath))
    }
    d = start
    drawn = false
  }
  for (const { key, data: v } of normalize(
    absolutize(parsePath(separateArcFlags(data))),
  )) {
    if (key === 'M') {
      finish(false)
      start = d = `M${map(v[0], v[1])}`
    } else if (key === 'Z') finish(true)
    else {
      d +=
        key === 'L'
          ? `L${map(v[0], v[1])}`
          : `C${map(v[0], v[1])} ${map(v[2], v[3])} ${map(v[4], v[5])}`
      drawn = true
    }
  }
  finish(false)
  return result
}

// CSS absolute units, at 96 pixels per inch as the browser renders them.
const UNITS: Record<string, number> = {
  px: 1,
  in: 96,
  cm: 96 / 2.54,
  mm: 96 / 25.4,
  pt: 96 / 72,
  pc: 16,
}

function number(element: Element, name: string) {
  const value = element.getAttribute(name)?.trim() ?? ''
  const scale = UNITS[value.slice(-2).toLowerCase()] ?? 1
  return parseFloat(value) * scale || 0
}

const NUMBER = /^[\s,]*([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)/i
const FLAG = /^[\s,]*([01])/

// Minified path data packs arc flags without separators ("a5 5 0 1010 0"). Spell them out.
function separateArcFlags(data: string) {
  return data.replace(/([Aa])([^A-DF-Za-df-z]*)/g, (_, command, args) => {
    const values: string[] = []
    let rest: string = args
    for (let i = 0; ; i = (i + 1) % 7) {
      const match = (i === 3 || i === 4 ? FLAG : NUMBER).exec(rest)
      if (!match) break
      values.push(match[1])
      rest = rest.slice(match[0].length)
    }
    return command + values.join(' ') + rest
  })
}

function shapeData(element: Element): [data: string, closed: boolean] | null {
  switch (element.localName) {
    case 'path':
      return [element.getAttribute('d') ?? '', false]
    case 'rect': {
      const [x, y, w, h] = ['x', 'y', 'width', 'height'].map((name) =>
        number(element, name),
      )
      if (w <= 0 || h <= 0) return null
      const rawRx = number(element, element.hasAttribute('rx') ? 'rx' : 'ry')
      const rawRy = number(element, element.hasAttribute('ry') ? 'ry' : 'rx')
      const rounded = rawRx > 0 && rawRy > 0
      const rx = rounded ? Math.min(rawRx, w / 2) : 0
      const ry = rounded ? Math.min(rawRy, h / 2) : 0
      const k = BEZIER_ARC
      const corner = (data: string) => (rounded ? data : '')
      return [
        `M${x + rx} ${y}L${x + w - rx} ${y}` +
          corner(
            `C${x + w - rx * k} ${y} ${x + w} ${y + ry * k} ${x + w} ${y + ry}`,
          ) +
          `L${x + w} ${y + h - ry}` +
          corner(
            `C${x + w} ${y + h - ry * k} ${x + w - rx * k} ${y + h} ${x + w - rx} ${y + h}`,
          ) +
          `L${x + rx} ${y + h}` +
          corner(
            `C${x + rx * k} ${y + h} ${x} ${y + h - ry * k} ${x} ${y + h - ry}`,
          ) +
          `L${x} ${y + ry}` +
          corner(`C${x} ${y + ry * k} ${x + rx * k} ${y} ${x + rx} ${y}`),
        true,
      ]
    }
    case 'circle':
    case 'ellipse': {
      const cx = number(element, 'cx'),
        cy = number(element, 'cy')
      const rx = number(element, element.localName === 'circle' ? 'r' : 'rx')
      const ry = number(element, element.localName === 'circle' ? 'r' : 'ry')
      if (rx <= 0 || ry <= 0) return null
      return [
        `M${cx + rx} ${cy}A${rx} ${ry} 0 1 1 ${cx - rx} ${cy}A${rx} ${ry} 0 1 1 ${cx + rx} ${cy}`,
        true,
      ]
    }
    case 'line':
      return [
        `M${number(element, 'x1')} ${number(element, 'y1')}L${number(element, 'x2')} ${number(element, 'y2')}`,
        false,
      ]
    case 'polygon':
    case 'polyline': {
      const values = (element.getAttribute('points') ?? '')
        .trim()
        .split(/[\s,]+/)
        .map(Number)
      let data = ''
      for (let i = 0; i + 1 < values.length; i += 2)
        data += `${i ? 'L' : 'M'}${values[i]} ${values[i + 1]}`
      return [data, element.localName === 'polygon']
    }
    default:
      return null
  }
}

// The element's transform, then a <use> element's x/y offset, as SVG specifies.
function ownMatrix(element: Element): Matrix {
  const list = (element as SVGGraphicsElement).transform?.baseVal
  const own = (list?.numberOfItems && list.consolidate()?.matrix) || identity
  if (element.localName !== 'use') return own
  return multiply(own, {
    ...identity,
    e: number(element, 'x'),
    f: number(element, 'y'),
  })
}

/**
 * Collects the subpaths of every shape in trusted SVG markup, with group and
 * `use` transforms applied. Supports path, rect, circle, ellipse, line,
 * polygon, polyline and use. Ignores defs, styles and viewBox.
 */
export function svgSubpaths(svg: Element): Subpath[] {
  const result: Subpath[] = []
  const visit = (element: Element, parent: Matrix, depth: number) => {
    if (
      depth > 32 ||
      element.namespaceURI !== svg.namespaceURI ||
      element.localName === 'defs'
    )
      return
    const matrix = multiply(parent, ownMatrix(element))
    const shape = shapeData(element)
    if (shape?.[0])
      for (const path of pathSubpaths(shape[0], matrix, shape[1]))
        result.push(path)
    if (element.localName === 'use') {
      const href =
        element.getAttribute('href') ??
        element.getAttributeNS('http://www.w3.org/1999/xlink', 'href')
      const target = href?.startsWith('#')
        ? svg.ownerDocument.getElementById(href.slice(1))
        : null
      if (target) visit(target, matrix, depth + 1)
    }
    for (const child of element.children) visit(child, matrix, depth + 1)
  }
  visit(svg, identity, 0)
  return result
}
