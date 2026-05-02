import { parseSvgLength, roundBoardNumber } from './svgExhibitPlacement'

export interface SvgDimensions {
  height: number
  minX: number
  minY: number
  width: number
}

interface StripUnsafeSvgOptions {
  includeRoot?: boolean
  removeDecorative?: boolean
}

const defaultSvgSize = {
  width: 800,
  height: 600,
}
const lockedFallbackTags = new Set(['image', 'use'])
const unsafeSvgTags = new Set([
  'audio',
  'canvas',
  'embed',
  'iframe',
  'object',
  'script',
  'video',
])
const decorativeSvgTags = new Set([
  'clippath',
  'filter',
  'lineargradient',
  'mask',
  'pattern',
  'radialgradient',
  'style',
])
const urlAttributeNames = new Set([
  'href',
  'src',
  'xlink:href',
])

export function inlineStyleValue(element: Element, property: string) {
  const style = element.getAttribute('style')
  if (!style)
    return undefined

  const escapedProperty = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = style.match(new RegExp(`(?:^|;)\\s*${escapedProperty}\\s*:\\s*([^;]+)`, 'i'))
  return match?.[1]?.replace(/\s*!important\s*$/i, '').trim()
}

export function paintAlpha(value: string | null | undefined) {
  const normalized = (value || '').trim().toLowerCase()
  if (!normalized || normalized === 'none' || normalized === 'transparent')
    return 0

  const rgba = normalized.match(/^rgba?\(([^)]+)\)$/)
  if (!rgba)
    return 1

  const parts = rgba[1].split(',').map(part => Number(part.trim().replace('%', '')))
  if (parts.length < 4)
    return 1

  return Number.isFinite(parts[3]) ? Math.max(0, Math.min(1, parts[3])) : 1
}

function classText(element: Element) {
  return (element.getAttribute('class') || '').toLowerCase()
}

export function hasClassFragment(element: Element, fragments: string[]) {
  let current: Element | null = element
  while (current) {
    const classes = classText(current)
    if (fragments.some(fragment => classes.includes(fragment)))
      return true

    current = current.parentElement
  }

  return false
}

export function isLabelBackground(element: Element) {
  const tagName = element.tagName.toLowerCase()
  return (tagName === 'rect' || tagName === 'polygon')
    && hasClassFragment(element, ['labelbkg', 'edge-label', 'edgelabel'])
}

export function hasLockedFallbackContent(root: Element) {
  return Array.from(root.querySelectorAll('*')).some((element) => {
    const tagName = element.tagName.toLowerCase()
    return lockedFallbackTags.has(tagName)
  })
}

function isUnsafeUrl(value: string) {
  const normalized = value.replace(/[\u0000-\u001F\u007F\s]+/g, '').toLowerCase()
  return normalized.startsWith('javascript:')
    || normalized.startsWith('data:text/html')
    || normalized.startsWith('vbscript:')
}

function cleanStyleText(value: string) {
  return value
    .replace(/@import\b[^;]+;?/gi, '')
    .replace(/url\(\s*(['"]?)\s*(?:javascript|vbscript):[^)]*\)/gi, 'none')
}

export function stripUnsafeSvg(root: Element, options: StripUnsafeSvgOptions = {}) {
  const includeRoot = options.includeRoot ?? true
  const removeDecorative = options.removeDecorative ?? false
  const elements = includeRoot
    ? [root, ...Array.from(root.querySelectorAll('*'))]
    : Array.from(root.querySelectorAll('*'))

  elements.forEach((element) => {
    const tagName = element.tagName.toLowerCase()
    if (unsafeSvgTags.has(tagName) || (removeDecorative && decorativeSvgTags.has(tagName))) {
      element.remove()
      return
    }

    Array.from(element.attributes).forEach((attribute) => {
      const name = attribute.name.toLowerCase()
      if (name.startsWith('on') || name === 'srcdoc') {
        element.removeAttribute(attribute.name)
        return
      }

      if (removeDecorative && (name === 'clip-path' || name === 'filter' || name === 'mask')) {
        element.removeAttribute(attribute.name)
        return
      }

      if (urlAttributeNames.has(name) && isUnsafeUrl(attribute.value))
        element.removeAttribute(attribute.name)
    })

    if (tagName === 'style' && element.textContent)
      element.textContent = cleanStyleText(element.textContent)
  })
}

export function appendInlineStyle(element: Element, declarations: string[]) {
  const current = element.getAttribute('style')?.trim()
  const normalizedCurrent = current
    ? current.endsWith(';') ? current : `${current};`
    : ''

  element.setAttribute('style', `${normalizedCurrent}${declarations.join(';')};`)
}

export function inlineForeignObjectPresentation(
  root: SVGSVGElement,
  foreignObjectDeclarations: string[],
  childDeclarations: string[],
) {
  root.querySelectorAll('foreignObject').forEach((foreignObject) => {
    appendInlineStyle(foreignObject, foreignObjectDeclarations)
    foreignObject.querySelectorAll('*').forEach((element) => {
      appendInlineStyle(element, childDeclarations)
    })
  })
}

export function svgDimensions(svg: SVGSVGElement, fallback = defaultSvgSize): SvgDimensions {
  const viewBox = svg.getAttribute('viewBox')
    ?.trim()
    .split(/[\s,]+/)
    .map(Number)

  if (viewBox?.length === 4 && viewBox.every(Number.isFinite)) {
    return {
      minX: viewBox[0],
      minY: viewBox[1],
      width: Math.max(1, viewBox[2]),
      height: Math.max(1, viewBox[3]),
    }
  }

  const width = parseSvgLength(svg.getAttribute('width')) || fallback.width
  const height = parseSvgLength(svg.getAttribute('height')) || fallback.height
  return { minX: 0, minY: 0, width, height }
}

export function serializedChild(node: ChildNode, serializer: XMLSerializer) {
  if (node.nodeType === Node.TEXT_NODE)
    return node.textContent?.trim() ? node.textContent : ''

  return serializer.serializeToString(node)
}

export function normalizedSvgInner(svg: SVGSVGElement, minX: number, minY: number) {
  const serializer = new XMLSerializer()
  const content = Array.from(svg.childNodes)
    .map(node => serializedChild(node, serializer))
    .filter(value => value.trim().length > 0)
    .join('')

  return minX || minY
    ? `<g transform="translate(${roundBoardNumber(-minX)} ${roundBoardNumber(-minY)})">${content}</g>`
    : content
}
