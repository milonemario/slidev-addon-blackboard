import type { BlackboardBoard } from '../shared/blackboardProtocol'
import type { BlackboardDrawingSyncOperation } from './blackboardSync'
import {
  blackboardElementIdAttribute,
  blackboardPreviewIdAttribute,
  ensureBlackboardElementId,
  ensureBlackboardElementIds,
  serializeBlackboardElement,
  serializeBlackboardPreviewElement,
  topLevelElementMap,
} from './blackboardDrauuAdapter'
import { normalizeDrawingColors } from './svgExhibitPlacement'

export function snapshotDrawingElements(svg: SVGElement | undefined | null) {
  return topLevelElementMap(svg)
}

export function replaceDrawingOperation(drawing: string): BlackboardDrawingSyncOperation {
  return {
    drawing,
    type: 'replaceDrawing',
  }
}

export function upsertElementOperation(element: Element, index: number, previewId?: string): BlackboardDrawingSyncOperation {
  const elementId = ensureBlackboardElementId(element)
  return {
    elementId,
    elementSvg: serializeBlackboardElement(element),
    index,
    previewId,
    type: 'upsertElement',
  }
}

export function previewElementOperation(element: Element, index: number, previewId: string): BlackboardDrawingSyncOperation {
  return {
    elementSvg: serializeBlackboardPreviewElement(element, previewId),
    index,
    previewId,
    type: 'previewElement',
  }
}

export function clearPreviewOperation(previewId: string): BlackboardDrawingSyncOperation {
  return {
    previewId,
    type: 'clearPreview',
  }
}

export function removeElementsOperation(elementIds: string[]): BlackboardDrawingSyncOperation | undefined {
  if (!elementIds.length)
    return undefined

  return {
    elementIds,
    type: 'removeElements',
  }
}

export function drawingOperationsFromElementDiff(before: Map<string, Element>, svg: SVGElement | undefined | null) {
  if (!svg)
    return undefined

  ensureBlackboardElementIds(svg)
  const after = topLevelElementMap(svg)
  const removed = Array.from(before.keys()).filter(id => !after.has(id))
  const added = Array.from(after.entries()).filter(([id]) => !before.has(id))

  if (removed.length && !added.length) {
    const operation = removeElementsOperation(removed)
    return operation ? [operation] : []
  }

  if (added.length && !removed.length) {
    const children = Array.from(svg.children)
    return added.map(([, element]) => upsertElementOperation(element, Math.max(0, children.indexOf(element))))
  }

  return removed.length || added.length ? undefined : []
}

function svgFragmentRoot(drawing: string) {
  if (typeof document === 'undefined')
    return undefined

  const root = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  root.innerHTML = normalizeDrawingColors(drawing || '')
  ensureBlackboardElementIds(root)
  return root
}

function parseSyncedElement(elementSvg: string, expectedId: string) {
  const root = svgFragmentRoot(elementSvg)
  const element = root?.firstElementChild
  if (!element)
    return undefined

  element.setAttribute(blackboardElementIdAttribute, expectedId)
  element.removeAttribute(blackboardPreviewIdAttribute)
  return element
}

export function parsePreviewElement(elementSvg: string, expectedPreviewId: string) {
  const root = svgFragmentRoot(elementSvg)
  const element = root?.firstElementChild
  if (!element)
    return undefined

  element.removeAttribute(blackboardElementIdAttribute)
  element.setAttribute(blackboardPreviewIdAttribute, expectedPreviewId)
  return element
}

export function drawingWithOperation(drawing: string, operation: BlackboardDrawingSyncOperation) {
  if (operation.type === 'previewElement' || operation.type === 'clearPreview')
    return undefined

  if (operation.type === 'replaceDrawing')
    return normalizeDrawingColors(operation.drawing || '')

  const root = svgFragmentRoot(drawing)
  if (!root)
    return undefined

  if (operation.type === 'removeElements') {
    const ids = new Set(operation.elementIds)
    Array.from(root.children).forEach((element) => {
      const id = element.getAttribute(blackboardElementIdAttribute)
      if (id && ids.has(id))
        element.remove()
    })
    return root.innerHTML
  }

  const element = parseSyncedElement(operation.elementSvg, operation.elementId)
  if (!element)
    return undefined

  const existing = Array.from(root.children).find(child => child.getAttribute(blackboardElementIdAttribute) === operation.elementId)
  if (existing) {
    existing.replaceWith(element)
    return root.innerHTML
  }

  const children = Array.from(root.children)
  const index = Math.max(0, Math.min(operation.index, children.length))
  const reference = children[index]
  if (reference)
    root.insertBefore(element, reference)
  else
    root.appendChild(element)
  return root.innerHTML
}

export function boardsWithDrawingOperation(
  boards: BlackboardBoard[],
  targetId: string,
  operation: BlackboardDrawingSyncOperation,
) {
  const now = Date.now()
  let applied = false
  const nextBoards = boards.map((board) => {
    if (board.id !== targetId)
      return board

    const drawing = drawingWithOperation(board.drawing || '', operation)
    if (drawing == null)
      return board

    applied = true
    return {
      ...board,
      drawing,
      updatedAt: now,
    }
  })

  return {
    applied,
    boards: nextBoards,
  }
}
