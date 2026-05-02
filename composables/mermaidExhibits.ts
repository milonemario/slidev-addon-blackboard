import { renderMermaid as renderSlidevMermaid } from '@slidev/client/modules/mermaid.ts'
import lz from 'lz-string'
import type { BlackboardMermaidSourceExhibit, BlackboardRenderedExhibit } from './blackboardTypes'
import {
  normalizeExhibitPlacement,
  placeInlineSvgFragments,
  placeLockedExhibitSvg,
  primaryBrushColor,
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

const mermaidMinStrokeWidth = 3
const geometryTags = new Set(['circle', 'ellipse', 'line', 'path', 'polygon', 'polyline', 'rect'])
const copiedPresentationAttributes = [
  'alignment-baseline',
  'dominant-baseline',
  'font-family',
  'font-size',
  'font-style',
  'font-weight',
  'opacity',
  'stroke-dasharray',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-width',
  'text-anchor',
]

const mermaidThemeVariables = {
  actorBkg: 'transparent',
  actorBorder: primaryBrushColor,
  actorLineColor: primaryBrushColor,
  actorTextColor: primaryBrushColor,
  activationBkgColor: 'transparent',
  activationBorderColor: primaryBrushColor,
  altBackground: 'transparent',
  arrowheadColor: primaryBrushColor,
  background: 'transparent',
  clusterBkg: 'transparent',
  clusterBorder: primaryBrushColor,
  defaultLinkColor: primaryBrushColor,
  dropShadow: 'none',
  edgeLabelBackground: 'transparent',
  fontFamily: 'Inter, Arial, sans-serif',
  fontSize: '16px',
  labelBackgroundColor: 'transparent',
  labelBoxBkgColor: 'transparent',
  labelBoxBorderColor: primaryBrushColor,
  labelTextColor: primaryBrushColor,
  lineColor: primaryBrushColor,
  mainBkg: 'transparent',
  nodeBkg: 'transparent',
  nodeBorder: primaryBrushColor,
  nodeTextColor: primaryBrushColor,
  noteBkgColor: 'transparent',
  noteBorderColor: primaryBrushColor,
  noteTextColor: primaryBrushColor,
  primaryBorderColor: primaryBrushColor,
  primaryColor: 'transparent',
  primaryTextColor: primaryBrushColor,
  secondaryBorderColor: primaryBrushColor,
  secondaryColor: 'transparent',
  secondaryTextColor: primaryBrushColor,
  signalColor: primaryBrushColor,
  signalTextColor: primaryBrushColor,
  strokeWidth: `${mermaidMinStrokeWidth}px`,
  tertiaryBorderColor: primaryBrushColor,
  tertiaryColor: 'transparent',
  tertiaryTextColor: primaryBrushColor,
  textColor: primaryBrushColor,
  titleColor: primaryBrushColor,
  transitionColor: primaryBrushColor,
  useGradient: false,
}

const mermaidThemeCss = `
  .node rect,
  .node circle,
  .node ellipse,
  .node polygon,
  .node path,
  .note,
  .actor {
    fill: transparent;
    stroke: ${primaryBrushColor};
    stroke-width: ${mermaidMinStrokeWidth}px;
  }
  .edgeLabel,
  .labelBkg,
  .edgeLabel rect,
  .edgeLabel polygon {
    background: transparent !important;
    fill: transparent !important;
    stroke: transparent !important;
  }
  .edgePath .path,
  .flowchart-link,
  .messageLine0,
  .messageLine1,
  .loopLine,
  .transition,
  path.relationshipLine {
    fill: none !important;
    stroke: ${primaryBrushColor} !important;
    stroke-width: ${mermaidMinStrokeWidth}px !important;
  }
  marker path,
  marker polygon,
  .arrowheadPath {
    fill: ${primaryBrushColor} !important;
    stroke: ${primaryBrushColor} !important;
  }
  text,
  tspan {
    fill: ${primaryBrushColor} !important;
    color: ${primaryBrushColor} !important;
    stroke: none !important;
  }
  foreignObject,
  foreignObject * {
    background: transparent !important;
    color: ${primaryBrushColor} !important;
  }
`

let mermaidRenderId = 0

function cssNumber(value: string | null | undefined) {
  const number = Number.parseFloat(value || '')
  return Number.isFinite(number) ? number : undefined
}

function effectivePaintAlpha(element: Element, computed: CSSStyleDeclaration, property: 'fill' | 'stroke') {
  return paintAlpha(inlineStyleValue(element, property) || computed.getPropertyValue(property))
}

function effectiveStrokeWidth(element: Element, computed: CSSStyleDeclaration) {
  return cssNumber(inlineStyleValue(element, 'stroke-width') || element.getAttribute('stroke-width') || computed.strokeWidth) || 0
}

function copyComputedPresentation(element: Element, computed: CSSStyleDeclaration) {
  copiedPresentationAttributes.forEach((attribute) => {
    const value = computed.getPropertyValue(attribute).trim()
    if (value && value !== 'normal' && value !== 'auto')
      element.setAttribute(attribute, value)
  })
}

function setMinimumStrokeWidth(element: Element, computed: CSSStyleDeclaration) {
  const strokeWidth = cssNumber(element.getAttribute('stroke-width') || computed.strokeWidth) || 0
  element.setAttribute('stroke-width', `${Math.max(mermaidMinStrokeWidth, strokeWidth)}`)
  element.setAttribute('stroke-linecap', 'round')
  element.setAttribute('stroke-linejoin', 'round')
}

function inlineBoardPresentation(root: SVGSVGElement) {
  root.querySelectorAll('*').forEach((element) => {
    if (typeof SVGElement !== 'undefined' && !(element instanceof SVGElement))
      return

    if (isLabelBackground(element)) {
      element.remove()
      return
    }

    const tagName = element.tagName.toLowerCase()
    const computed = window.getComputedStyle(element)
    const fillAlpha = effectivePaintAlpha(element, computed, 'fill')
    const strokeAlpha = effectivePaintAlpha(element, computed, 'stroke')
    const strokeWidth = effectiveStrokeWidth(element, computed)
    copyComputedPresentation(element, computed)
    element.removeAttribute('style')

    if (tagName === 'text' || tagName === 'tspan') {
      element.setAttribute('fill', primaryBrushColor)
      element.setAttribute('stroke', 'none')
      return
    }

    if (!geometryTags.has(tagName))
      return

    const hasVisiblePaint = fillAlpha > 0 || (strokeAlpha > 0 && strokeWidth > 0)
    const insideMarker = !!element.closest('marker')
    if (!hasVisiblePaint) {
      element.setAttribute('fill', 'none')
      element.setAttribute('stroke', 'none')
      return
    }

    element.setAttribute('stroke', primaryBrushColor)
    element.setAttribute('fill', insideMarker ? primaryBrushColor : 'none')
    setMinimumStrokeWidth(element, computed)
  })
}

function normalizeRenderedMermaidSvg(svgMarkup: string, exhibit: BlackboardMermaidSourceExhibit): BlackboardRenderedExhibit {
  if (typeof XMLSerializer === 'undefined' || typeof document === 'undefined')
    throw new Error('Mermaid rendering requires a browser document')

  const container = document.createElement('div')
  container.style.cssText = 'position:absolute;left:-10000px;top:-10000px;width:1px;height:1px;overflow:hidden;visibility:hidden;pointer-events:none;'
  container.innerHTML = svgMarkup
  document.body.appendChild(container)

  try {
    const svg = container.querySelector('svg') as SVGSVGElement | null
    if (!svg)
      throw new Error('Mermaid did not produce an SVG')

    inlineBoardPresentation(svg)
    inlineForeignObjectPresentation(svg, [
      'background:transparent !important',
      `color:${primaryBrushColor} !important`,
    ], [
      'background:transparent !important',
      'border-color:currentColor !important',
      `color:${primaryBrushColor} !important`,
    ])
    stripUnsafeSvg(svg, { includeRoot: false, removeDecorative: true })

    const dimensions = svgDimensions(svg)
    return {
      id: exhibit.id,
      category: exhibit.category,
      kind: 'mermaid',
      placement: hasLockedFallbackContent(svg) ? 'locked' : 'exploded',
      title: exhibit.title,
      width: Math.ceil(dimensions.width),
      height: Math.ceil(dimensions.height),
      svg: normalizedSvgInner(svg, dimensions.minX, dimensions.minY),
    }
  }
  finally {
    container.remove()
  }
}

export async function renderMermaidExhibit(exhibit: BlackboardMermaidSourceExhibit): Promise<BlackboardRenderedExhibit> {
  const source = exhibit.source.trim()
  if (!source)
    throw new Error('Mermaid exhibit is empty')

  mermaidRenderId += 1
  const rendered = await renderSlidevMermaid(lz.compressToBase64(source), {
    deterministicIds: false,
    deterministicIDSeed: `slidev-blackboard-mermaid-${Date.now()}-${mermaidRenderId}`,
    flowchart: {
      htmlLabels: true,
      useMaxWidth: false,
    },
    htmlLabels: true,
    securityLevel: 'loose',
    sequence: {
      useMaxWidth: false,
    },
    startOnLoad: false,
    theme: 'base',
    themeCSS: mermaidThemeCss,
    themeVariables: mermaidThemeVariables,
  })
  return normalizeRenderedMermaidSvg(rendered, exhibit)
}

export function placeMermaidExhibitSvg(svg: string, x: number, y: number, scale: number, exhibit: BlackboardRenderedExhibit) {
  return normalizeExhibitPlacement(exhibit.placement) === 'locked'
    ? placeLockedExhibitSvg(svg, x, y, scale, exhibit)
    : placeInlineSvgFragments(svg, x, y, scale, exhibit, 'mermaid')
}
