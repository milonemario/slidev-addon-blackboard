import type { DrawingMode } from 'drauu'
import { normalizeDrawingColors } from './svgExhibitPlacement'

type BlackboardToolMode = DrawingMode | 'arrow'

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

  reindexDrauuElements(drauu)
  return true
}

export function currentDrauuDrawing(drauu: DrauuAdapterTarget) {
  return drauu.dump()
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
