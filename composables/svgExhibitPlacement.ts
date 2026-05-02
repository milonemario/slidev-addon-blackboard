import type {
  BlackboardExhibitKind,
  BlackboardExhibitPlacement,
  BlackboardPlacementRect,
  BlackboardPoint,
  BlackboardRenderedExhibit,
} from './blackboardTypes'

export const legacyPrimaryBrushColor = '#f8f5d7'
export const primaryBrushColor = '#ffffff'
export const whiteboardPrimaryColor = '#000000'

const geometryTags = new Set([
  'circle',
  'ellipse',
  'line',
  'path',
  'polygon',
  'polyline',
  'rect',
])
const preservedInlineTags = new Set([
  'foreignobject',
])
const passthroughContainerTags = new Set([
  'a',
  'g',
  'svg',
])
const skippedInlineTags = new Set([
  'defs',
  'desc',
  'style',
  'title',
])

const inheritedAttributes = [
  'alignment-baseline',
  'dominant-baseline',
  'fill',
  'fill-opacity',
  'font-family',
  'font-size',
  'font-style',
  'font-weight',
  'opacity',
  'stroke',
  'stroke-dasharray',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'stroke-opacity',
  'stroke-width',
  'text-anchor',
]

export function normalizePrimaryColor(color: string) {
  return color.toLowerCase() === legacyPrimaryBrushColor ? primaryBrushColor : color
}

export function normalizeDrawingColors(drawing: string) {
  return drawing.replace(/#f8f5d7/gi, primaryBrushColor)
}

export function normalizeExhibitKind(kind: unknown): BlackboardExhibitKind {
  if (kind === 'mermaid' || kind === 'image' || kind === 'svg')
    return kind

  return 'table'
}

export function normalizeExhibitPlacement(placement: unknown): BlackboardExhibitPlacement {
  return placement === 'locked' ? 'locked' : 'exploded'
}

export function roundBoardNumber(value: number, precision = 2) {
  const factor = 10 ** precision
  return Number.isFinite(value) ? Math.round(value * factor) / factor : 0
}

export function numericAttribute(value: string | null) {
  if (value == null || !/^-?\d+(?:\.\d+)?$/.test(value))
    return undefined

  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}

export function parseSvgLength(value: string | null) {
  if (!value)
    return undefined

  const match = value.trim().match(/^-?\d+(?:\.\d+)?/)
  if (!match)
    return undefined

  const number = Number(match[0])
  return Number.isFinite(number) ? number : undefined
}

export function escapeSvgAttribute(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function copyInheritedAttributes(target: Element, inherited: Record<string, string>) {
  Object.entries(inherited).forEach(([name, value]) => {
    if (!target.hasAttribute(name))
      target.setAttribute(name, value)
  })

  target.removeAttribute('marker-end')
  target.removeAttribute('marker-mid')
  target.removeAttribute('marker-start')
}

function setExhibitMetadata(element: Element, exhibit: BlackboardRenderedExhibit, kind: BlackboardExhibitKind) {
  element.setAttribute('data-blackboard-exhibit-segment', kind)
  element.setAttribute('data-blackboard-exhibit-id', exhibit.id)
  element.setAttribute('data-blackboard-exhibit-kind', kind)
  element.setAttribute('data-blackboard-exhibit-title', exhibit.title)
}

function placedElementTransform(x: number, y: number, scale: number, transforms: string[], ownTransform: string | null) {
  return [
    `translate(${roundBoardNumber(x)} ${roundBoardNumber(y)}) scale(${roundBoardNumber(scale, 4)})`,
    ...transforms,
    ...(ownTransform ? [ownTransform] : []),
  ].join(' ')
}

export function placeInlineSvgFragments(svg: string, x: number, y: number, scale: number, exhibit: BlackboardRenderedExhibit, kind: BlackboardExhibitKind) {
  if (typeof XMLSerializer === 'undefined' || typeof document === 'undefined')
    return ''

  const parsedContainer = document.createElement('div')
  parsedContainer.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg">${svg}</svg>`
  const parsedRoot = parsedContainer.querySelector('svg')
  if (!parsedRoot)
    return ''

  const serializer = new XMLSerializer()

  function flattenElements(parent: Element, transforms: string[] = [], inherited: Record<string, string> = {}): Element[] {
    return Array.from(parent.children).flatMap((child) => {
      const tagName = child.tagName.toLowerCase()
      if (skippedInlineTags.has(tagName))
        return []

      const nextInherited = { ...inherited }
      inheritedAttributes.forEach((name) => {
        const value = child.getAttribute(name)
        if (value)
          nextInherited[name] = value
      })

      const childTransform = child.getAttribute('transform')
      const nextTransforms = childTransform
        ? [...transforms, childTransform]
        : transforms

      if (passthroughContainerTags.has(tagName))
        return flattenElements(child, nextTransforms, nextInherited)

      if (tagName !== 'text' && tagName !== 'tspan' && !geometryTags.has(tagName) && !preservedInlineTags.has(tagName))
        return []

      const clone = child.cloneNode(true) as Element
      copyInheritedAttributes(clone, nextInherited)
      clone.setAttribute('transform', placedElementTransform(x, y, scale, transforms, child.getAttribute('transform')))

      if (geometryTags.has(tagName))
        clone.setAttribute('data-blackboard-exhibit-erase-by-bounds', 'true')

      setExhibitMetadata(clone, exhibit, kind)
      return [clone]
    })
  }

  return flattenElements(parsedRoot)
    .map(node => serializer.serializeToString(node))
    .join('')
}

export function placeLockedExhibitSvg(svg: string, x: number, y: number, scale: number, exhibit: BlackboardRenderedExhibit) {
  const width = roundBoardNumber(exhibit.width * scale)
  const height = roundBoardNumber(exhibit.height * scale)
  return [
    `<svg x="${roundBoardNumber(x)}" y="${roundBoardNumber(y)}" width="${width}" height="${height}" viewBox="0 0 ${roundBoardNumber(exhibit.width)} ${roundBoardNumber(exhibit.height)}" preserveAspectRatio="xMidYMid meet" overflow="visible" data-blackboard-exhibit-locked="true" data-blackboard-exhibit-id="${escapeSvgAttribute(exhibit.id)}" data-blackboard-exhibit-kind="${normalizeExhibitKind(exhibit.kind)}" data-blackboard-exhibit-title="${escapeSvgAttribute(exhibit.title)}">`,
    svg,
    '</svg>',
  ].join('')
}

export function lineIntersectsLine(a: BlackboardPoint, b: BlackboardPoint, c: BlackboardPoint, d: BlackboardPoint) {
  const denominator = ((d.y - c.y) * (b.x - a.x)) - ((d.x - c.x) * (b.y - a.y))
  if (denominator === 0)
    return false

  const ua = (((d.x - c.x) * (a.y - c.y)) - ((d.y - c.y) * (a.x - c.x))) / denominator
  const ub = (((b.x - a.x) * (a.y - c.y)) - ((b.y - a.y) * (a.x - c.x))) / denominator
  return ua >= 0 && ua <= 1 && ub >= 0 && ub <= 1
}

function pointInRect(point: BlackboardPoint, rect: BlackboardPlacementRect) {
  return point.x >= rect.x
    && point.x <= rect.x + rect.width
    && point.y >= rect.y
    && point.y <= rect.y + rect.height
}

export function lineIntersectsRect(start: BlackboardPoint, end: BlackboardPoint, rect: BlackboardPlacementRect) {
  if (pointInRect(start, rect) || pointInRect(end, rect))
    return true

  const topLeft = { x: rect.x, y: rect.y }
  const topRight = { x: rect.x + rect.width, y: rect.y }
  const bottomRight = { x: rect.x + rect.width, y: rect.y + rect.height }
  const bottomLeft = { x: rect.x, y: rect.y + rect.height }

  return lineIntersectsLine(start, end, topLeft, topRight)
    || lineIntersectsLine(start, end, topRight, bottomRight)
    || lineIntersectsLine(start, end, bottomRight, bottomLeft)
    || lineIntersectsLine(start, end, bottomLeft, topLeft)
}
