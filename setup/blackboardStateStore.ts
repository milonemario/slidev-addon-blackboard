import { existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { BlackboardBoard, BlackboardPersistedState } from '../shared/blackboardProtocol'
import { normalizeBoardTheme } from '../shared/blackboardProtocol'
import { normalizeDrawingColors } from '../composables/svgExhibitPlacement'
import type { BlackboardSetupOptions } from './blackboardConfig'

interface BlackboardManifestBoard {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  file: string
  guideBoardId?: string | null
}

interface BlackboardManifest {
  activeBoardId?: string
  boards?: BlackboardManifestBoard[]
  createdAt?: number
  name?: string
  savedAt?: number
  theme?: unknown
}

function stripSvgWrapper(svg: string) {
  const trimmed = svg.trim()
  const match = trimmed.match(/^<svg\b[^>]*>([\s\S]*)<\/svg>$/i)
  return match ? match[1].trim() : svg
}

function wrapSvg(drawing: string, options: BlackboardSetupOptions) {
  const width = options.data?.config?.canvasWidth || 1400
  const aspectRatio = options.data?.config?.aspectRatio || 1.4
  const height = Math.ceil(width / aspectRatio)

  return [
    `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">`,
    normalizeDrawingColors(drawing || ''),
    '</svg>',
  ].join('\n')
}

function boardGuideBoardId(board: BlackboardManifestBoard | BlackboardBoard) {
  if (typeof board.guideBoardId === 'string' || board.guideBoardId === null)
    return board.guideBoardId

  return undefined
}

async function readDrawingFile(dir: string, file: string) {
  const content = await fs.readFile(path.join(dir, file), 'utf8')
  return normalizeDrawingColors(stripSvgWrapper(content))
}

// Legacy stores used one SVG file per board before manifest.json existed.
async function loadLegacySvgFiles(dir: string): Promise<BlackboardPersistedState> {
  const files = (await fs.readdir(dir))
    .filter(file => file.endsWith('.svg'))
    .sort()

  const boards = await Promise.all(files.map(async (file, index) => {
    const now = Date.now()
    return {
      id: path.basename(file, '.svg'),
      title: `Board ${index + 1}`,
      createdAt: now,
      updatedAt: now,
      drawing: await readDrawingFile(dir, file),
      guideBoardId: undefined,
    }
  }))

  return {
    activeBoardId: boards[0]?.id,
    boards,
  }
}

export async function loadPersistedState(dir: string | undefined): Promise<BlackboardPersistedState> {
  if (!dir || !existsSync(dir))
    return { boards: [] }

  const manifestFile = path.join(dir, 'manifest.json')
  if (!existsSync(manifestFile))
    return loadLegacySvgFiles(dir)

  const manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8')) as BlackboardManifest

  const boards = await Promise.all((manifest.boards || []).map(async (board, index) => ({
    id: board.id || `board-${index + 1}`,
    title: board.title || `Board ${index + 1}`,
    createdAt: board.createdAt || Date.now(),
    updatedAt: board.updatedAt || board.createdAt || Date.now(),
    drawing: board.file ? await readDrawingFile(dir, board.file).catch(() => '') : '',
    guideBoardId: boardGuideBoardId(board),
  })))

  return {
    activeBoardId: manifest.activeBoardId,
    boards,
    createdAt: manifest.createdAt,
    name: manifest.name,
    savedAt: manifest.savedAt,
    theme: normalizeBoardTheme(manifest.theme),
  }
}

export async function writePersistedState(dir: string | undefined, state: BlackboardPersistedState, options: BlackboardSetupOptions) {
  if (!dir)
    return

  await fs.mkdir(dir, { recursive: true })

  const boards = state.boards || []
  const manifestBoards: BlackboardManifestBoard[] = boards.map((board, index) => ({
    id: board.id,
    title: board.title || `Board ${index + 1}`,
    createdAt: board.createdAt || Date.now(),
    updatedAt: board.updatedAt || Date.now(),
    file: `${String(index + 1).padStart(3, '0')}.svg`,
    ...(boardGuideBoardId(board) !== undefined ? { guideBoardId: boardGuideBoardId(board) } : {}),
  }))

  await Promise.all(manifestBoards.map((board, index) => {
    const drawing = boards[index]?.drawing || ''
    return fs.writeFile(path.join(dir, board.file), wrapSvg(drawing, options), 'utf8')
  }))

  const keepFiles = new Set(manifestBoards.map(board => board.file))
  const existingFiles = (await fs.readdir(dir)).filter(file => file.endsWith('.svg'))
  await Promise.all(existingFiles
    .filter(file => !keepFiles.has(file))
    .map(file => fs.unlink(path.join(dir, file))))

  await fs.writeFile(path.join(dir, 'manifest.json'), JSON.stringify({
    version: 1,
    activeBoardId: state.activeBoardId,
    ...(state.createdAt ? { createdAt: state.createdAt } : {}),
    ...(state.name ? { name: state.name } : {}),
    ...(state.savedAt ? { savedAt: state.savedAt } : {}),
    boards: manifestBoards,
    ...(state.theme ? { theme: normalizeBoardTheme(state.theme) } : {}),
  }, null, 2), 'utf8')
}
