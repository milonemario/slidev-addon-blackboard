import type { DrawingMode } from 'drauu'
import { normalizeDrawingColors } from './svgExhibitPlacement'

type BlackboardToolMode = DrawingMode | 'arrow'
export const blackboardElementIdAttribute = 'data-blackboard-element-id'
export const blackboardPreviewIdAttribute = 'data-blackboard-preview-id'

interface DrauuAdapterTarget {
  clear: () => void
  dump: () => string
  el?: SVGElement
  load: (svg: string) => void
  mounted: boolean
}

export function loadDrauuDrawing(drauu: DrauuAdapterTarget, svg: string) {
  const drawing = normalizeDrawingColors(svg)
  if (!drauu.mounted)
    return false

  if (drawing)
    drauu.load(drawing)
  else
    drauu.clear()

  ensureBlackboardElementIds(drauu.el)
  clearBlackboardPreviewElements(drauu.el)
  reindexDrauuElements(drauu)
  return true
}

export function currentDrauuDrawing(drauu: DrauuAdapterTarget) {
  clearBlackboardPreviewElements(drauu.el)
  ensureBlackboardElementIds(drauu.el)
  return drauu.dump()
}

export function createBlackboardElementId() {
  const randomId = globalThis.crypto?.randomUUID?.()
  return randomId
    ? `bbe-${randomId}`
    : `bbe-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function ensureBlackboardElementIds(svg: SVGElement | undefined | null) {
  if (!svg)
    return

  Array.from(svg.children).forEach((element) => {
    if (!element.getAttribute(blackboardElementIdAttribute))
      element.setAttribute(blackboardElementIdAttribute, createBlackboardElementId())
  })
}

export function ensureBlackboardElementId(element: Element) {
  const existing = element.getAttribute(blackboardElementIdAttribute)
  if (existing)
    return existing

  const id = createBlackboardElementId()
  element.setAttribute(blackboardElementIdAttribute, id)
  return id
}

export function topLevelElementMap(svg: SVGElement | undefined | null) {
  ensureBlackboardElementIds(svg)
  const map = new Map<string, Element>()
  if (!svg)
    return map

  Array.from(svg.children).forEach((element) => {
    const id = element.getAttribute(blackboardElementIdAttribute)
    if (id)
      map.set(id, element)
  })
  return map
}

export function serializeBlackboardElement(element: Element) {
  ensureBlackboardElementId(element)
  return element.outerHTML
}

export function currentDrauuPreviewElement(drauu: DrauuAdapterTarget) {
  return (drauu as any)._currentNode instanceof Element
    ? (drauu as any)._currentNode as Element
    : undefined
}

export function serializeBlackboardPreviewElement(element: Element, previewId: string) {
  const clone = element.cloneNode(true) as Element
  clone.removeAttribute(blackboardElementIdAttribute)
  clone.setAttribute(blackboardPreviewIdAttribute, previewId)
  return clone.outerHTML
}

export function clearBlackboardPreviewElements(svg: SVGElement | undefined | null, previewId?: string) {
  if (!svg)
    return

  Array.from(svg.querySelectorAll(`[${blackboardPreviewIdAttribute}]`)).forEach((element) => {
    if (!previewId || element.getAttribute(blackboardPreviewIdAttribute) === previewId)
      element.remove()
  })
}

export function upsertBlackboardPreviewElement(svg: SVGElement | undefined | null, element: Element, index: number) {
  if (!svg)
    return false

  const previewId = element.getAttribute(blackboardPreviewIdAttribute)
  if (!previewId)
    return false

  clearBlackboardPreviewElements(svg, previewId)
  const children = Array.from(svg.children)
  const safeIndex = Math.max(0, Math.min(index, children.length))
  const reference = children[safeIndex]
  if (reference)
    svg.insertBefore(element, reference)
  else
    svg.appendChild(element)
  return true
}

export function isSvgGraphicsElement(element: Element): element is SVGGraphicsElement {
  return typeof (element as SVGGraphicsElement).getBBox === 'function'
}

export function refreshEraserFragments(drauu: DrauuAdapterTarget, drawingMode: BlackboardToolMode) {
  if (!drauu.mounted || drawingMode !== 'eraseLine')
    return

  // Drauu does not expose a public hook to rebuild eraseLine fragments after
  // programmatic SVG edits, so the adapter centralizes the private access.
  const eraser = (drauu as any)._models?.eraseLine
  eraser?.onUnselected?.()
  eraser?.onSelected?.(drauu.el)
}

export function reindexDrauuElements(drauu: DrauuAdapterTarget) {
  if (!drauu.el)
    return

  // Drauu stores element order privately; locked exhibits removed outside
  // pointer drawing need the same index refresh as normal drawing operations.
  const drauuInternals = drauu as any
  const elements = Array.from(drauu.el.children) as SVGGraphicsElement[]
  drauuInternals._elements = elements
  elements.forEach((element, index) => {
    element.dataset.drauu_index = `${index}`
  })
}
