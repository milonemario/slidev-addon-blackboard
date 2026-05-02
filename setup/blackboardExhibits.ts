import MarkdownIt from 'markdown-it'
import { existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import type {
  BlackboardExhibitKind,
  BlackboardRenderedExhibit,
  BlackboardSvgSourceExhibit,
} from '../shared/blackboardProtocol'
import { BLACKBOARD_EXHIBIT_ASSET_ENDPOINT } from '../shared/blackboardProtocol'

interface BlackboardExhibitMetadata {
  id: string
  title: string
  category?: string
  file: string
  kind: BlackboardExhibitKind
}

export interface BlackboardExhibitSource {
  categoryPrefix?: string
  dir: string | undefined
  idPrefix?: string
}

interface BlackboardMermaidExhibit {
  id: string
  title: string
  category?: string
  kind: 'mermaid'
  source: string
}

type BlackboardTableAlignment = 'left' | 'center' | 'right'

interface BlackboardMarkdownTable {
  rows: string[][]
  alignments: BlackboardTableAlignment[]
}

interface MarkdownItToken {
  type: string
  tag: string
  content: string
  attrs: [string, string][] | null
  children?: MarkdownItToken[] | null
}

interface MarkdownItParser {
  parse: (src: string, env: Record<string, unknown>) => MarkdownItToken[]
}

const fallbackImageSize = {
  width: 800,
  height: 450,
}
const imageMimeTypes: Record<string, string> = {
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
}

let cachedMarkdownIt: MarkdownItParser | undefined

type BlackboardExhibitSourceInput = BlackboardExhibitSource | BlackboardExhibitSource[] | string | undefined

function markdownTableParser() {
  if (!cachedMarkdownIt) {
    cachedMarkdownIt = new MarkdownIt({
      html: false,
      linkify: false,
      typographer: false,
    })
  }

  return cachedMarkdownIt
}

function toPosixPath(value: string) {
  return value.split(path.sep).join('/')
}

function formatExhibitTitle(file: string) {
  const basename = path.basename(file, path.extname(file))
  return basename
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, char => char.toUpperCase())
}

function normalizeExhibitSources(sources: BlackboardExhibitSourceInput): BlackboardExhibitSource[] {
  if (!sources)
    return []

  if (typeof sources === 'string')
    return [{ dir: sources }]

  if (Array.isArray(sources))
    return sources

  return [sources]
}

function exhibitId(source: BlackboardExhibitSource, relative: string) {
  return `${source.idPrefix || ''}${relative}`
}

function exhibitCategory(source: BlackboardExhibitSource, relative: string) {
  const dirname = path.posix.dirname(relative)
  const parts = dirname === '.'
    ? []
    : dirname.split('/').map(formatExhibitTitle)

  if (source.categoryPrefix)
    parts.unshift(source.categoryPrefix)

  return parts.length > 0 ? parts.join(' / ') : undefined
}

export function publicExhibitMetadata(exhibit: BlackboardExhibitMetadata) {
  return {
    id: exhibit.id,
    kind: exhibit.kind,
    title: exhibit.title,
    ...(exhibit.category ? { category: exhibit.category } : {}),
  }
}

function exhibitKindForFile(file: string): BlackboardExhibitKind | undefined {
  const extension = path.extname(file).toLowerCase()
  if (extension === '.md')
    return 'table'
  if (extension === '.mmd' || extension === '.mermaid')
    return 'mermaid'
  if (extension === '.svg')
    return 'svg'
  if (imageMimeTypes[extension])
    return 'image'

  return undefined
}

async function listExhibitsFromSource(source: BlackboardExhibitSource): Promise<BlackboardExhibitMetadata[]> {
  const dir = source.dir
  if (!dir || !existsSync(dir))
    return []

  const files: string[] = []

  async function walk(currentDir: string) {
    const entries = (await fs.readdir(currentDir, { withFileTypes: true }).catch(() => []))
      .sort((a, b) => a.name.localeCompare(b.name))

    await Promise.all(entries.map(async (entry) => {
      const entryPath = path.join(currentDir, entry.name)
      if (entry.isDirectory()) {
        await walk(entryPath)
        return
      }

      if (entry.isFile() && exhibitKindForFile(entry.name))
        files.push(entryPath)
    }))
  }

  await walk(dir)

  return files
    .sort()
    .map((file) => {
      const relative = toPosixPath(path.relative(dir, file))
      return {
        id: exhibitId(source, relative),
        kind: exhibitKindForFile(file) || 'table',
        title: formatExhibitTitle(relative),
        category: exhibitCategory(source, relative),
        file,
      }
    })
}

export async function listExhibits(sources: BlackboardExhibitSourceInput): Promise<BlackboardExhibitMetadata[]> {
  const exhibits = (await Promise.all(normalizeExhibitSources(sources).map(listExhibitsFromSource))).flat()
  const seen = new Set<string>()

  return exhibits.filter((exhibit) => {
    if (seen.has(exhibit.id))
      return false

    seen.add(exhibit.id)
    return true
  })
}

function imageMimeType(file: string) {
  return imageMimeTypes[path.extname(file).toLowerCase()] || 'application/octet-stream'
}

function imageAssetUrl(id: string) {
  return `${BLACKBOARD_EXHIBIT_ASSET_ENDPOINT}?id=${encodeURIComponent(id)}`
}

function pngDimensions(buffer: Buffer) {
  return buffer.length >= 24 && buffer.toString('ascii', 1, 4) === 'PNG'
    ? { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
    : undefined
}

function gifDimensions(buffer: Buffer) {
  return buffer.length >= 10 && buffer.toString('ascii', 0, 3) === 'GIF'
    ? { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) }
    : undefined
}

function bmpDimensions(buffer: Buffer) {
  return buffer.length >= 26 && buffer.toString('ascii', 0, 2) === 'BM'
    ? { width: Math.abs(buffer.readInt32LE(18)), height: Math.abs(buffer.readInt32LE(22)) }
    : undefined
}

function jpegDimensions(buffer: Buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xFF || buffer[1] !== 0xD8)
    return undefined

  let offset = 2
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xFF) {
      offset += 1
      continue
    }

    const marker = buffer[offset + 1]
    const length = buffer.readUInt16BE(offset + 2)
    if (length < 2)
      return undefined

    if (marker >= 0xC0 && marker <= 0xCF && ![0xC4, 0xC8, 0xCC].includes(marker)) {
      return {
        width: buffer.readUInt16BE(offset + 7),
        height: buffer.readUInt16BE(offset + 5),
      }
    }

    offset += 2 + length
  }

  return undefined
}

function webpDimensions(buffer: Buffer) {
  if (buffer.length < 30 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WEBP')
    return undefined

  const chunk = buffer.toString('ascii', 12, 16)
  if (chunk === 'VP8X') {
    return {
      width: 1 + buffer.readUIntLE(24, 3),
      height: 1 + buffer.readUIntLE(27, 3),
    }
  }

  if (chunk === 'VP8 ' && buffer.length >= 30) {
    return {
      width: buffer.readUInt16LE(26) & 0x3FFF,
      height: buffer.readUInt16LE(28) & 0x3FFF,
    }
  }

  if (chunk === 'VP8L' && buffer.length >= 25) {
    const b0 = buffer[21]
    const b1 = buffer[22]
    const b2 = buffer[23]
    const b3 = buffer[24]
    return {
      width: 1 + b0 + ((b1 & 0x3F) << 8),
      height: 1 + ((b1 & 0xC0) >> 6) + (b2 << 2) + ((b3 & 0x0F) << 10),
    }
  }

  return undefined
}

function svgDimensions(buffer: Buffer) {
  const text = buffer.toString('utf8', 0, Math.min(buffer.length, 4096))
  const svg = text.match(/<svg\b[^>]*>/i)?.[0]
  if (!svg)
    return undefined

  const viewBox = svg.match(/\bviewBox=(["'])([^"']+)\1/i)?.[2]
    ?.trim()
    .split(/[\s,]+/)
    .map(Number)
  if (viewBox?.length === 4 && viewBox.every(Number.isFinite)) {
    return {
      width: Math.max(1, viewBox[2]),
      height: Math.max(1, viewBox[3]),
    }
  }

  const width = Number.parseFloat(svg.match(/\bwidth=(["'])([^"']+)\1/i)?.[2] || '')
  const height = Number.parseFloat(svg.match(/\bheight=(["'])([^"']+)\1/i)?.[2] || '')
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
    ? { width, height }
    : undefined
}

function imageDimensionsFromBuffer(buffer: Buffer, file: string) {
  const extension = path.extname(file).toLowerCase()
  const dimensions = extension === '.png'
    ? pngDimensions(buffer)
    : extension === '.gif'
      ? gifDimensions(buffer)
      : extension === '.jpg' || extension === '.jpeg'
        ? jpegDimensions(buffer)
        : extension === '.webp'
          ? webpDimensions(buffer)
          : extension === '.bmp'
            ? bmpDimensions(buffer)
            : extension === '.svg'
              ? svgDimensions(buffer)
              : undefined

  return dimensions && dimensions.width > 0 && dimensions.height > 0
    ? {
        width: Math.ceil(dimensions.width),
        height: Math.ceil(dimensions.height),
      }
    : fallbackImageSize
}

function normalizeTableRows(rows: string[][], alignments: BlackboardTableAlignment[]): BlackboardMarkdownTable {
  const columnCount = Math.max(...rows.map(row => row.length), alignments.length)
  return {
    alignments: Array.from({ length: columnCount }, (_, index) => alignments[index] || 'left'),
    rows: rows.map(row => Array.from({ length: columnCount }, (_, index) => row[index] || '')),
  }
}

function tokenAttr(token: MarkdownItToken, name: string) {
  return token.attrs?.find(([key]) => key === name)?.[1]
}

function tokenAlignment(token: MarkdownItToken): BlackboardTableAlignment | undefined {
  const style = tokenAttr(token, 'style') || ''
  const match = style.match(/text-align\s*:\s*(left|center|right)/i)
  return match?.[1]?.toLowerCase() as BlackboardTableAlignment | undefined
}

function inlineTokenText(token: MarkdownItToken) {
  const children = token.children || []
  if (!children.length)
    return token.content

  return children
    .map((child) => {
      if (child.type === 'hardbreak' || child.type === 'softbreak')
        return ' '
      if (child.type.endsWith('_open') || child.type.endsWith('_close'))
        return ''
      return child.content || ''
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
}

function parseMarkdownTable(markdown: string): BlackboardMarkdownTable | undefined {
  const tokens = markdownTableParser().parse(markdown, {})
  const tableStart = tokens.findIndex(token => token.type === 'table_open')
  if (tableStart < 0)
    return undefined

  const rows: string[][] = []
  let alignments: BlackboardTableAlignment[] = []
  let currentRow: { align?: BlackboardTableAlignment, text: string }[] | undefined
  let currentCell: { align?: BlackboardTableAlignment, text: string } | undefined

  for (let index = tableStart + 1; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (token.type === 'table_close')
      break

    if (token.type === 'tr_open') {
      currentRow = []
      continue
    }

    if ((token.type === 'th_open' || token.type === 'td_open') && currentRow) {
      currentCell = {
        align: tokenAlignment(token),
        text: '',
      }
      continue
    }

    if (token.type === 'inline' && currentCell) {
      currentCell.text = inlineTokenText(token)
      continue
    }

    if ((token.type === 'th_close' || token.type === 'td_close') && currentRow && currentCell) {
      currentRow.push(currentCell)
      currentCell = undefined
      continue
    }

    if (token.type === 'tr_close' && currentRow) {
      if (currentRow.length > 0) {
        if (rows.length === 0)
          alignments = currentRow.map(cell => cell.align || 'left')

        rows.push(currentRow.map(cell => cell.text))
      }
      currentRow = undefined
    }
  }

  if (!rows.length || rows[0].length < 2)
    return undefined

  return normalizeTableRows(rows, alignments)
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function normalizeInlineMarkdown(value: string) {
  return value
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

function wrapTableText(value: string, maxChars: number) {
  const normalized = normalizeInlineMarkdown(value)
  if (!normalized)
    return ['']

  const lines: string[] = []
  let current = ''

  for (const word of normalized.split(' ')) {
    if (word.length > maxChars) {
      if (current) {
        lines.push(current)
        current = ''
      }

      for (let index = 0; index < word.length; index += maxChars)
        lines.push(word.slice(index, index + maxChars))
      continue
    }

    const next = current ? `${current} ${word}` : word
    if (next.length > maxChars && current) {
      lines.push(current)
      current = word
    }
    else {
      current = next
    }
  }

  if (current)
    lines.push(current)

  return lines
}

function roundSvgNumber(value: number) {
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : 0
}

function renderCellText(parts: string[], lines: string[], x: number, y: number, lineHeight: number, fontSize: number, fontWeight: number, align: BlackboardTableAlignment) {
  const visibleLines = lines.filter(line => line.length > 0)
  if (!visibleLines.length)
    return

  const anchor = align === 'center'
    ? 'middle'
    : align === 'right'
      ? 'end'
      : 'start'
  const tspans = visibleLines
    .map((line, index) => `<tspan x="${roundSvgNumber(x)}"${index === 0 ? '' : ` dy="${lineHeight}"`}>${escapeXml(line)}</tspan>`)
    .join('')

  parts.push(`<text x="${roundSvgNumber(x)}" y="${roundSvgNumber(y)}" fill="#ffffff" font-size="${fontSize}" font-weight="${fontWeight}" text-anchor="${anchor}">${tspans}</text>`)
}

function renderMarkdownTableSvg(table: BlackboardMarkdownTable): Pick<BlackboardRenderedExhibit, 'width' | 'height' | 'svg'> {
  const paddingX = 18
  const paddingY = 10
  const headerFontSize = 24
  const bodyFontSize = 22
  const lineHeight = 30
  const minColumnWidth = 96
  const maxColumnWidth = 280
  const characterWidth = 12
  const columnCount = table.rows[0]?.length || 0

  const columnWidths = Array.from({ length: columnCount }, (_, column) => {
    const maxLength = Math.max(4, ...table.rows.map(row => normalizeInlineMarkdown(row[column] || '').length))
    return Math.max(minColumnWidth, Math.min(maxColumnWidth, (maxLength * characterWidth) + (paddingX * 2)))
  })

  const wrappedRows = table.rows.map(row => row.map((cell, column) => {
    const maxChars = Math.max(6, Math.floor((columnWidths[column] - (paddingX * 2)) / 10.5))
    return wrapTableText(cell, maxChars)
  }))

  const rowHeights = wrappedRows.map((row, rowIndex) => {
    const maxLines = Math.max(...row.map(cell => cell.length))
    const fontSize = rowIndex === 0 ? headerFontSize : bodyFontSize
    return Math.max(48, (maxLines * lineHeight) + (paddingY * 2) + Math.max(0, fontSize - bodyFontSize))
  })

  const width = Math.ceil(columnWidths.reduce((total, value) => total + value, 0)) + 2
  const height = Math.ceil(rowHeights.reduce((total, value) => total + value, 0)) + 2
  const parts: string[] = [
    '<g data-blackboard-exhibit-table="true" font-family="Inter, Arial, sans-serif">',
    `<rect x="1" y="1" width="${width - 2}" height="${height - 2}" fill="none" stroke="#ffffff" stroke-opacity="0.46" stroke-width="2"/>`,
  ]

  let y = 1
  for (let rowIndex = 0; rowIndex < table.rows.length; rowIndex += 1) {
    let x = 1
    const isHeader = rowIndex === 0
    const fontSize = isHeader ? headerFontSize : bodyFontSize
    const fontWeight = isHeader ? 700 : 500

    for (let column = 0; column < columnCount; column += 1) {
      const columnWidth = columnWidths[column]
      const rowHeight = rowHeights[rowIndex]
      const align = table.alignments[column] || 'left'
      const textX = align === 'center'
        ? x + (columnWidth / 2)
        : align === 'right'
          ? x + columnWidth - paddingX
          : x + paddingX
      const lines = wrappedRows[rowIndex][column]
      const textY = y + paddingY + fontSize

      parts.push(`<rect x="${x}" y="${y}" width="${columnWidth}" height="${rowHeight}" fill="none" stroke="#ffffff" stroke-opacity="0.3" stroke-width="1"/>`)
      renderCellText(parts, lines, textX, textY, lineHeight, fontSize, fontWeight, align)
      x += columnWidth
    }

    y += rowHeights[rowIndex]
  }

  parts.push('</g>')

  return {
    width,
    height,
    svg: parts.join(''),
  }
}

async function loadTableExhibit(exhibit: BlackboardExhibitMetadata): Promise<BlackboardRenderedExhibit> {
  const markdown = await fs.readFile(exhibit.file, 'utf8')
  const table = parseMarkdownTable(markdown)
  if (!table)
    throw new Error('Markdown file does not contain a supported pipe table')

  const rendered = renderMarkdownTableSvg(table)
  return {
    ...publicExhibitMetadata(exhibit),
    kind: 'table',
    ...rendered,
  }
}

async function loadMermaidExhibit(exhibit: BlackboardExhibitMetadata): Promise<BlackboardMermaidExhibit> {
  return {
    ...publicExhibitMetadata(exhibit),
    kind: 'mermaid',
    source: await fs.readFile(exhibit.file, 'utf8'),
  }
}

async function loadImageExhibit(exhibit: BlackboardExhibitMetadata): Promise<BlackboardRenderedExhibit> {
  const src = imageAssetUrl(exhibit.id)
  const dimensions = imageDimensionsFromBuffer(await fs.readFile(exhibit.file), exhibit.file)
  const width = Math.max(1, dimensions.width)
  const height = Math.max(1, dimensions.height)
  return {
    ...publicExhibitMetadata(exhibit),
    kind: 'image',
    placement: 'locked',
    width,
    height,
    svg: `<image href="${escapeXml(src)}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="xMidYMid meet"/>`,
  }
}

async function loadSvgExhibit(exhibit: BlackboardExhibitMetadata): Promise<BlackboardSvgSourceExhibit> {
  return {
    ...publicExhibitMetadata(exhibit),
    kind: 'svg',
    source: await fs.readFile(exhibit.file, 'utf8'),
  }
}

export async function loadExhibit(sources: BlackboardExhibitSourceInput, id: string): Promise<BlackboardRenderedExhibit | BlackboardMermaidExhibit | BlackboardSvgSourceExhibit> {
  const exhibit = (await listExhibits(sources)).find(item => item.id === id)
  if (!exhibit)
    throw new Error('Exhibit was not found')

  if (exhibit.kind === 'mermaid')
    return await loadMermaidExhibit(exhibit)
  if (exhibit.kind === 'svg')
    return await loadSvgExhibit(exhibit)
  if (exhibit.kind === 'image')
    return await loadImageExhibit(exhibit)

  return await loadTableExhibit(exhibit)
}

export async function loadImageExhibitAsset(sources: BlackboardExhibitSourceInput, id: string) {
  const exhibit = (await listExhibits(sources)).find(item => item.id === id)
  if (!exhibit || (exhibit.kind !== 'image' && exhibit.kind !== 'svg'))
    throw new Error('Image exhibit was not found')

  return {
    buffer: await fs.readFile(exhibit.file),
    mimeType: imageMimeType(exhibit.file),
  }
}
