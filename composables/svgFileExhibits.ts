import type { BlackboardRenderedExhibit, BlackboardSvgSourceExhibit } from './blackboardTypes'
import {
  normalizeExhibitPlacement,
  parseSvgLength,
  placeInlineSvgFragments,
  placeLockedExhibitSvg,
  primaryBrushColor,
  roundBoardNumber,
} from './svgExhibitPlacement'
import {
  hasLockedFallbackContent,
  inlineForeignObjectPresentation,
  inlineStyleValue,
  isLabelBackground,
  normalizedSvgInner,
  paintAlpha,
  stripUnsafeSvg,
  svgDimensions,
} from './svgExhibitUtils'

const svgNamespace = 'http://www.w3.org/2000/svg'
const fallbackSvgSize = {
  width: 800,
  height: 450,
}

const blackboardExhibitFontFamily = 'Inter, Arial, sans-serif'
const defaultSvgStrokeWidth = '1'
const geometryTags = new Set(['circle', 'ellipse', 'line', 'path', 'polygon', 'polyline', 'rect'])
const inlinePresentationAttributes = [
  'alignment-baseline',
  'clip-rule',
  'dominant-baseline',
  'fill-opacity',
  'fill-rule',
  'font-size',
  'font-style',
  'font-weight',
  'opacity',
  'stroke-dasharray',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'stroke-opacity',
  'stroke-width',
  'text-anchor',
]

interface SvgPaintState {
  fill: string
  stroke: string
  strokeWidth?: string
}

function copyInlinePresentationAttributes(element: Element) {
  inlinePresentationAttributes.forEach((attribute) => {
    const value = inlineStyleValue(element, attribute)
    if (value && !element.hasAttribute(attribute))
      element.setAttribute(attribute, value)
  })
}

function isVisiblePaint(value: string | null | undefined) {
  return paintAlpha(value) > 0
}

function inheritedPaintValue(element: Element, state: SvgPaintState, property: 'fill' | 'stroke') {
  const value = inlineStyleValue(element, property)
    || element.getAttribute(property)
    || state[property]

  return value || (property === 'fill' ? '#000000' : 'none')
}

function inheritedStrokeWidth(element: Element, state: SvgPaintState) {
  return inlineStyleValue(element, 'stroke-width')
    || element.getAttribute('stroke-width')
    || state.strokeWidth
}

function normalizeTextElement(element: Element) {
  copyInlinePresentationAttributes(element)
  element.removeAttribute('style')
  element.setAttribute('fill', primaryBrushColor)
  element.setAttribute('stroke', 'none')
  element.setAttribute('font-family', blackboardExhibitFontFamily)
}

function normalizeGeometryElement(element: Element, state: SvgPaintState) {
  const tagName = element.tagName.toLowerCase()
  const fillVisible = isVisiblePaint(state.fill)
  const strokeWidth = state.strokeWidth || defaultSvgStrokeWidth
  const strokeVisible = isVisiblePaint(state.stroke)
    && (parseSvgLength(strokeWidth) ?? 1) > 0

  copyInlinePresentationAttributes(element)
  element.removeAttribute('style')

  if (!fillVisible && !strokeVisible) {
    element.setAttribute('fill', 'none')
    element.setAttribute('stroke', 'none')
    return
  }

  if (element.closest('[data-blackboard-svg-glyph="true"]')) {
    element.setAttribute('fill', fillVisible ? primaryBrushColor : 'none')
    element.setAttribute('stroke', strokeVisible ? primaryBrushColor : 'none')
    if (strokeVisible)
      element.setAttribute('stroke-width', strokeWidth)
    return
  }

  element.setAttribute('stroke', primaryBrushColor)
  element.setAttribute('fill', tagName === 'path' && element.closest('marker') ? primaryBrushColor : 'none')
  element.setAttribute('stroke-width', strokeVisible ? strokeWidth : defaultSvgStrokeWidth)
}

function normalizeSvgPresentation(root: SVGSVGElement) {
  const visit = (element: Element, state: SvgPaintState) => {
    const tagName = element.tagName.toLowerCase()
    if (isLabelBackground(element)) {
      element.remove()
      return
    }

    const nextState = {
      fill: inheritedPaintValue(element, state, 'fill'),
      stroke: inheritedPaintValue(element, state, 'stroke'),
      strokeWidth: inheritedStrokeWidth(element, state),
    }

    if (tagName === 'foreignobject')
      return

    if (tagName === 'text' || tagName === 'tspan')
      normalizeTextElement(element)
    else if (geometryTags.has(tagName))
      normalizeGeometryElement(element, nextState)
    else {
      copyInlinePresentationAttributes(element)
      element.removeAttribute('style')
    }

    Array.from(element.children).forEach(child => visit(child, nextState))
  }

  visit(root, { fill: '#000000', stroke: 'none' })
}

function usableSwitchTextFallback(element: Element) {
  const text = element.textContent?.trim() || ''
  return text.length > 0
    && !text.includes('...')
    && !text.includes('…')
    && text.toLowerCase() !== 'text is not svg - cannot display'
}

function resolveSwitchElements(root: SVGSVGElement) {
  root.querySelectorAll('switch').forEach((switchElement) => {
    const children = Array.from(switchElement.children)
    const textFallback = children.find((child) => {
      const tagName = child.tagName.toLowerCase()
      return tagName === 'text' && usableSwitchTextFallback(child)
    })
    const replacement = textFallback || children.find((child) => {
      const tagName = child.tagName.toLowerCase()
      return tagName !== 'title' && tagName !== 'desc'
    })

    if (!replacement) {
      switchElement.remove()
      return
    }

    switchElement.replaceWith(replacement)
  })
}

function useHref(element: Element) {
  return element.getAttribute('href') || element.getAttribute('xlink:href')
}

function fragmentIdentifier(href: string | null) {
  if (!href?.startsWith('#') || href.length <= 1)
    return undefined

  try {
    return decodeURIComponent(href.slice(1))
  }
  catch {
    return href.slice(1)
  }
}

function localIdMap(root: SVGSVGElement) {
  const ids = new Map<string, Element>()
  root.querySelectorAll('[id]').forEach((element) => {
    const id = element.getAttribute('id')
    if (id)
      ids.set(id, element)
  })
  return ids
}

function stripClonedIds(element: Element) {
  element.removeAttribute('id')
  element.querySelectorAll('[id]').forEach(child => child.removeAttribute('id'))
}

function isGlyphDefinition(element: Element) {
  const id = element.getAttribute('id') || ''
  return id.startsWith('glyph-')
}

function useTranslation(element: Element) {
  const x = parseSvgLength(element.getAttribute('x')) || 0
  const y = parseSvgLength(element.getAttribute('y')) || 0
  return x || y ? `translate(${roundBoardNumber(x)} ${roundBoardNumber(y)})` : undefined
}

function resolveUseElements(root: SVGSVGElement) {
  const ids = localIdMap(root)
  root.querySelectorAll('use').forEach((useElement) => {
    const id = fragmentIdentifier(useHref(useElement))
    const target = id ? ids.get(id) : undefined
    if (!target || target === useElement || useElement.contains(target))
      return

    const wrapper = root.ownerDocument.createElementNS(svgNamespace, 'g')
    if (isGlyphDefinition(target))
      wrapper.setAttribute('data-blackboard-svg-glyph', 'true')

    Array.from(useElement.attributes).forEach((attribute) => {
      const name = attribute.name.toLowerCase()
      if (name !== 'href' && name !== 'xlink:href' && name !== 'x' && name !== 'y' && name !== 'width' && name !== 'height')
        wrapper.setAttribute(attribute.name, attribute.value)
    })

    const transforms = [
      useElement.getAttribute('transform') || undefined,
      useTranslation(useElement),
    ].filter(Boolean)
    if (transforms.length)
      wrapper.setAttribute('transform', transforms.join(' '))

    const clone = target.cloneNode(true) as Element
    stripClonedIds(clone)
    wrapper.appendChild(clone)
    useElement.replaceWith(wrapper)
  })
}

export function renderSvgExhibit(exhibit: BlackboardSvgSourceExhibit): BlackboardRenderedExhibit {
  if (typeof DOMParser === 'undefined' || typeof XMLSerializer === 'undefined' || typeof document === 'undefined')
    throw new Error('SVG exhibits require a browser document')

  const parsed = new DOMParser().parseFromString(exhibit.source, 'image/svg+xml')
  if (parsed.querySelector('parsererror'))
    throw new Error('SVG exhibit could not be parsed')

  const parsedSvg = parsed.documentElement as SVGSVGElement | null
  if (!parsedSvg || parsedSvg.tagName.toLowerCase() !== 'svg')
    throw new Error('SVG exhibit must contain an SVG root')

  stripUnsafeSvg(parsedSvg)

  const svg = document.importNode(parsedSvg, true)
  resolveSwitchElements(svg)
  resolveUseElements(svg)
  normalizeSvgPresentation(svg)
  inlineForeignObjectPresentation(svg, [
    'background:transparent !important',
    `color:${primaryBrushColor} !important`,
    `font-family:${blackboardExhibitFontFamily} !important`,
  ], [
    'background:transparent !important',
    'border-color:currentColor !important',
    `color:${primaryBrushColor} !important`,
    `font-family:${blackboardExhibitFontFamily} !important`,
  ])
  stripUnsafeSvg(svg, { removeDecorative: true })

  const dimensions = svgDimensions(svg, fallbackSvgSize)
  return {
    id: exhibit.id,
    category: exhibit.category,
    kind: 'svg',
    placement: hasLockedFallbackContent(svg) ? 'locked' : 'exploded',
    title: exhibit.title,
    width: Math.ceil(dimensions.width),
    height: Math.ceil(dimensions.height),
    svg: normalizedSvgInner(svg, dimensions.minX, dimensions.minY),
  }
}

export function placeSvgExhibitSvg(svg: string, x: number, y: number, scale: number, exhibit: BlackboardRenderedExhibit) {
  const normalizedExhibit: BlackboardRenderedExhibit = {
    ...exhibit,
    kind: 'svg',
  }

  if (normalizeExhibitPlacement(exhibit.placement) !== 'locked') {
    const exploded = placeInlineSvgFragments(svg, x, y, scale, normalizedExhibit, 'svg')
    if (exploded)
      return exploded
  }

  return placeLockedExhibitSvg(svg, x, y, scale, {
    ...normalizedExhibit,
    placement: 'locked',
  })
}
