import type {
  BlackboardPlacementRect,
  BlackboardPoint,
} from '../shared/blackboardProtocol'
import { isSvgGraphicsElement } from './blackboardDrauuAdapter'
import {
  lineIntersectsRect,
  numericAttribute,
  parseSvgLength,
} from './svgExhibitPlacement'

const exhibitGeometryTags = new Set(['circle', 'ellipse', 'line', 'path', 'polygon', 'polyline', 'rect'])

function transformElementPointToBoard(svg: SVGSVGElement | undefined, element: SVGGraphicsElement, point: BlackboardPoint): BlackboardPoint {
  const elementMatrix = element.getScreenCTM?.()
  const svgMatrix = svg?.getScreenCTM?.()
  if (!svg || !elementMatrix || !svgMatrix)
    return point

  try {
    const matrix = svgMatrix.inverse().multiply(elementMatrix)
    if (typeof DOMPoint !== 'undefined') {
      const transformed = new DOMPoint(point.x, point.y).matrixTransform(matrix)
      return { x: transformed.x, y: transformed.y }
    }

    const svgPoint = svg.createSVGPoint()
    svgPoint.x = point.x
    svgPoint.y = point.y
    const transformed = svgPoint.matrixTransform(matrix)
    return { x: transformed.x, y: transformed.y }
  }
  catch {
    return point
  }
}

function transformBoardPointToElement(svg: SVGSVGElement | undefined, element: SVGGraphicsElement, point: BlackboardPoint): BlackboardPoint | undefined {
  const elementMatrix = element.getScreenCTM?.()
  const svgMatrix = svg?.getScreenCTM?.()
  if (!svg || !elementMatrix || !svgMatrix)
    return undefined

  try {
    const matrix = elementMatrix.inverse().multiply(svgMatrix)
    if (typeof DOMPoint !== 'undefined') {
      const transformed = new DOMPoint(point.x, point.y).matrixTransform(matrix)
      return { x: transformed.x, y: transformed.y }
    }

    const svgPoint = svg.createSVGPoint()
    svgPoint.x = point.x
    svgPoint.y = point.y
    const transformed = svgPoint.matrixTransform(matrix)
    return { x: transformed.x, y: transformed.y }
  }
  catch {
    return undefined
  }
}

function lockedExhibitBounds(element: SVGGraphicsElement): BlackboardPlacementRect | undefined {
  if (element.getAttribute('data-blackboard-exhibit-locked') !== 'true')
    return undefined

  const x = numericAttribute(element.getAttribute('x'))
  const y = numericAttribute(element.getAttribute('y'))
  const width = numericAttribute(element.getAttribute('width'))
  const height = numericAttribute(element.getAttribute('height'))
  if (x == null || y == null || width == null || height == null)
    return undefined

  return {
    x,
    y,
    width,
    height,
  }
}

function exhibitBounds(svg: SVGSVGElement | undefined, element: SVGGraphicsElement): BlackboardPlacementRect | undefined {
  const lockedBounds = lockedExhibitBounds(element)
  if (lockedBounds)
    return lockedBounds

  if (svg && typeof element.getBoundingClientRect === 'function') {
    const elementRect = element.getBoundingClientRect()
    const svgRect = svg.getBoundingClientRect()
    const viewBox = svg.viewBox.baseVal
    if ((elementRect.width > 0 || elementRect.height > 0) && svgRect.width > 0 && svgRect.height > 0) {
      const scaleX = viewBox.width / svgRect.width
      const scaleY = viewBox.height / svgRect.height
      return {
        x: viewBox.x + ((elementRect.left - svgRect.left) * scaleX),
        y: viewBox.y + ((elementRect.top - svgRect.top) * scaleY),
        width: elementRect.width * scaleX,
        height: elementRect.height * scaleY,
      }
    }
  }

  const x = numericAttribute(element.getAttribute('x'))
  const y = numericAttribute(element.getAttribute('y'))
  const width = numericAttribute(element.getAttribute('width'))
  const height = numericAttribute(element.getAttribute('height'))
  if (x != null && y != null && width != null && height != null) {
    const points = [
      transformElementPointToBoard(svg, element, { x, y }),
      transformElementPointToBoard(svg, element, { x: x + width, y }),
      transformElementPointToBoard(svg, element, { x: x + width, y: y + height }),
      transformElementPointToBoard(svg, element, { x, y: y + height }),
    ]
    const xs = points.map(point => point.x)
    const ys = points.map(point => point.y)
    const left = Math.min(...xs)
    const top = Math.min(...ys)
    return {
      x: left,
      y: top,
      width: Math.max(...xs) - left,
      height: Math.max(...ys) - top,
    }
  }

  try {
    const box = element.getBBox()
    const points = [
      transformElementPointToBoard(svg, element, { x: box.x, y: box.y }),
      transformElementPointToBoard(svg, element, { x: box.x + box.width, y: box.y }),
      transformElementPointToBoard(svg, element, { x: box.x + box.width, y: box.y + box.height }),
      transformElementPointToBoard(svg, element, { x: box.x, y: box.y + box.height }),
    ]
    const xs = points.map(point => point.x)
    const ys = points.map(point => point.y)
    const x = Math.min(...xs)
    const y = Math.min(...ys)
    return {
      x,
      y,
      width: Math.max(...xs) - x,
      height: Math.max(...ys) - y,
    }
  }
  catch {
    return undefined
  }
}

function paddedLineIntersectsBounds(svg: SVGSVGElement | undefined, element: SVGGraphicsElement, start: BlackboardPoint, end: BlackboardPoint, padding: number) {
  const bounds = exhibitBounds(svg, element)
  if (!bounds)
    return false

  return lineIntersectsRect(start, end, {
    x: bounds.x - padding,
    y: bounds.y - padding,
    width: bounds.width + (padding * 2),
    height: bounds.height + (padding * 2),
  })
}

function eraserProbePoints(start: BlackboardPoint, end: BlackboardPoint, padding: number) {
  const distance = Math.hypot(end.x - start.x, end.y - start.y)
  const steps = Math.max(1, Math.ceil(distance / Math.max(1, padding)))
  const points: BlackboardPoint[] = []
  const offset = Math.max(1, padding)
  const perpendicular = distance > 0
    ? { x: -((end.y - start.y) / distance) * offset, y: ((end.x - start.x) / distance) * offset }
    : undefined

  for (let index = 0; index <= steps; index += 1) {
    const t = steps === 0 ? 0 : index / steps
    const point = {
      x: start.x + ((end.x - start.x) * t),
      y: start.y + ((end.y - start.y) * t),
    }
    points.push(point)
    if (perpendicular) {
      points.push({ x: point.x + perpendicular.x, y: point.y + perpendicular.y })
      points.push({ x: point.x - perpendicular.x, y: point.y - perpendicular.y })
    }
    else {
      points.push({ x: point.x + offset, y: point.y })
      points.push({ x: point.x - offset, y: point.y })
      points.push({ x: point.x, y: point.y + offset })
      points.push({ x: point.x, y: point.y - offset })
    }
  }

  return points
}

function hasVisibleSvgPaint(value: string | null | undefined) {
  if (!value)
    return false

  const normalized = value.trim().toLowerCase()
  return normalized !== 'none'
    && normalized !== 'transparent'
    && normalized !== 'rgba(0, 0, 0, 0)'
}

function geometryIntersectsEraser(svg: SVGSVGElement | undefined, element: SVGGraphicsElement, start: BlackboardPoint, end: BlackboardPoint, padding: number) {
  if (!paddedLineIntersectsBounds(svg, element, start, end, padding))
    return false

  const geometry = element as SVGGeometryElement
  const strokeVisible = hasVisibleSvgPaint(element.getAttribute('stroke'))
    && (parseSvgLength(element.getAttribute('stroke-width')) ?? 1) > 0
  const fillVisible = hasVisibleSvgPaint(element.getAttribute('fill'))
  if (!strokeVisible && !fillVisible)
    return false

  if (typeof geometry.isPointInStroke !== 'function' && typeof geometry.isPointInFill !== 'function')
    return true

  return eraserProbePoints(start, end, padding).some((point) => {
    const localPoint = transformBoardPointToElement(svg, element, point)
    if (!localPoint)
      return false

    return (strokeVisible && typeof geometry.isPointInStroke === 'function' && geometry.isPointInStroke(localPoint))
      || (fillVisible && typeof geometry.isPointInFill === 'function' && geometry.isPointInFill(localPoint))
  })
}

export function eraserIntersectingExhibits(svg: SVGSVGElement, start: BlackboardPoint, end: BlackboardPoint, padding: number) {
  const lockedExhibits = Array.from(svg.children as HTMLCollectionOf<Element>)
    .filter((element): element is SVGGraphicsElement => (
      isSvgGraphicsElement(element)
      && element.getAttribute('data-blackboard-exhibit-locked') === 'true'
    ))
  const erasedLockedExhibits = lockedExhibits.filter((element) => {
    return paddedLineIntersectsBounds(svg, element, start, end, padding)
  })

  const exhibits = Array.from(svg.children as HTMLCollectionOf<Element>)
    .filter((element): element is SVGGraphicsElement => {
      const tagName = element.tagName.toLowerCase()
      return isSvgGraphicsElement(element)
        && !!element.getAttribute('data-blackboard-exhibit-segment')
        && (
          tagName === 'text'
          || tagName === 'foreignobject'
          || element.getAttribute('data-blackboard-exhibit-erase-by-bounds') === 'true'
        )
    })
  const erased = exhibits.filter((element) => {
    const tagName = element.tagName.toLowerCase()
    return exhibitGeometryTags.has(tagName)
      ? geometryIntersectsEraser(svg, element, start, end, padding)
      : paddedLineIntersectsBounds(svg, element, start, end, padding)
  })

  return {
    erased,
    erasedLockedExhibits,
  }
}
