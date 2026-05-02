import { existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import type {
  BlackboardBoard,
  BlackboardBoardSetKind,
  BlackboardBoardSetSummary,
  BlackboardPersistedState,
} from '../shared/blackboardProtocol'
import { boardSetKey } from '../shared/blackboardProtocol'
import { sanitizeDeckName, type BlackboardSetupOptions } from './blackboardConfig'
import { loadPersistedState, writePersistedState } from './blackboardStateStore'

function cloneBoardWithUniqueId(board: BlackboardBoard, existingIds: Set<string>, index: number): BlackboardBoard {
  if (!existingIds.has(board.id)) {
    existingIds.add(board.id)
    return board
  }

  const id = `board-${Date.now()}-${Math.random().toString(36).slice(2)}`
  existingIds.add(id)
  return {
    ...board,
    id,
    title: board.title || `Board ${index + 1}`,
  }
}

function mergePrefilledLiveBoards(
  state: BlackboardPersistedState,
  prefilledState: BlackboardPersistedState,
): { changed: boolean, state: BlackboardPersistedState } {
  if (!prefilledState.boards.length)
    return { changed: false, state }

  if (!state.boards.length) {
    return {
      changed: true,
      state: {
        activeBoardId: prefilledState.activeBoardId || prefilledState.boards[0]?.id,
        boards: prefilledState.boards,
        theme: prefilledState.theme,
      },
    }
  }

  if (state.boards.length >= prefilledState.boards.length)
    return { changed: false, state }

  const existingIds = new Set(state.boards.map(board => board.id))
  const appendedBoards = prefilledState.boards
    .slice(state.boards.length)
    .map((board, offset) => cloneBoardWithUniqueId(board, existingIds, state.boards.length + offset))

  return {
    changed: true,
    state: {
      activeBoardId: state.activeBoardId || state.boards[0]?.id || appendedBoards[0]?.id,
      boards: [
        ...state.boards,
        ...appendedBoards,
      ],
      theme: state.theme || prefilledState.theme,
    },
  }
}

export async function loadSeededPersistedState(
  persistDir: string | undefined,
  prefilledLiveDir: string,
  options: BlackboardSetupOptions,
): Promise<BlackboardPersistedState> {
  const state = await loadPersistedState(persistDir)
  if (!persistDir)
    return state

  const prefilledState = await loadDefaultBoardSetState(prefilledLiveDir, 'prefilled-live')
  const merged = mergePrefilledLiveBoards(state, prefilledState)
  if (!merged.changed)
    return state

  await writePersistedState(persistDir, merged.state, options)
  return await loadPersistedState(persistDir)
}

function boardSetIdFromName(name: string) {
  return sanitizeDeckName(name.trim() || 'default').slice(0, 100) || 'default'
}

function defaultBoardSetName(kind: BlackboardBoardSetKind) {
  if (kind === 'guide')
    return 'Default guides'
  if (kind === 'prefilled-live')
    return 'Default pre-made live blackboards'
  if (kind === 'saved-live')
    return 'Saved live blackboards'

  return 'Current live blackboards'
}

function boardSetDisplayName(id: string, state: BlackboardPersistedState, kind: BlackboardBoardSetKind) {
  if (state.name?.trim())
    return state.name.trim()

  if (id === 'default')
    return defaultBoardSetName(kind)

  return id
    .replace(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-/, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    || id
}

export function isSafeBoardSetId(id: string) {
  return /^[a-zA-Z0-9._-]+$/.test(id)
}

async function readActiveBoardSetId(rootDir: string | undefined) {
  if (!rootDir)
    return undefined

  try {
    const manifest = JSON.parse(await fs.readFile(path.join(rootDir, 'active.json'), 'utf8')) as { id?: string }
    return manifest.id && isSafeBoardSetId(manifest.id) ? manifest.id : undefined
  }
  catch {
    return undefined
  }
}

async function writeActiveBoardSetId(rootDir: string | undefined, id: string) {
  if (!rootDir || !isSafeBoardSetId(id))
    return

  await fs.mkdir(rootDir, { recursive: true })
  await fs.writeFile(path.join(rootDir, 'active.json'), JSON.stringify({ id }, null, 2), 'utf8')
}

async function uniqueBoardSetId(rootDir: string, name: string) {
  const base = boardSetIdFromName(name)
  let id = base
  for (let index = 2; existsSync(path.join(rootDir, id)); index += 1)
    id = `${base}-${index}`

  return id
}

async function listBoardSetKind(rootDir: string | undefined, kind: BlackboardBoardSetKind): Promise<BlackboardBoardSetSummary[]> {
  if (!rootDir || !existsSync(rootDir))
    return []

  const activeId = await readActiveBoardSetId(rootDir)
  const entries = await fs.readdir(rootDir, { withFileTypes: true }).catch(() => [])
  const subfolderSets = await Promise.all(entries
    .filter(entry => entry.isDirectory())
    .map(async (entry) => {
      const id = entry.name
      const state = await loadPersistedState(path.join(rootDir, id))
      return {
        active: id === activeId,
        boardCount: state.boards.length,
        id,
        key: boardSetKey(kind, id),
        kind,
        name: boardSetDisplayName(id, state, kind),
        savedAt: state.savedAt || state.createdAt,
      }
    }))

  return subfolderSets
    .filter(set => set.boardCount > 0)
    .sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0) || b.id.localeCompare(a.id))
}

export async function listBoardSets(
  persistDir: string | undefined,
  guideRootDir: string | undefined,
  prefilledLiveDir: string,
  savedLiveRootDir: string,
): Promise<BlackboardBoardSetSummary[]> {
  const sets: BlackboardBoardSetSummary[] = []
  const currentState = await loadPersistedState(persistDir)
  if (currentState.boards.length) {
    sets.push({
      boardCount: currentState.boards.length,
      id: 'current',
      key: boardSetKey('current-live', 'current'),
      kind: 'current-live',
      name: 'Current live blackboards',
    })
  }

  sets.push(
    ...await listBoardSetKind(guideRootDir, 'guide'),
    ...await listBoardSetKind(prefilledLiveDir, 'prefilled-live'),
    ...await listBoardSetKind(savedLiveRootDir, 'saved-live'),
  )
  return sets
}

export async function loadBoardSetState(
  kind: BlackboardBoardSetKind,
  id: string,
  persistDir: string | undefined,
  guideRootDir: string | undefined,
  prefilledLiveDir: string,
  savedLiveRootDir: string,
): Promise<BlackboardPersistedState> {
  if (kind === 'current-live' || id === 'current')
    return await loadPersistedState(persistDir)

  if (!isSafeBoardSetId(id))
    return { boards: [] }

  const rootDir = kind === 'guide'
    ? guideRootDir
    : kind === 'prefilled-live'
      ? prefilledLiveDir
      : kind === 'saved-live'
        ? savedLiveRootDir
        : undefined

  if (!rootDir)
    return { boards: [] }

  return await loadPersistedState(path.join(rootDir, id))
}

export async function loadDefaultBoardSetSelection(
  rootDir: string | undefined,
  kind: BlackboardBoardSetKind,
): Promise<{ id: string, state: BlackboardPersistedState }> {
  if (!rootDir)
    return { id: 'default', state: { boards: [] } }

  const activeId = await readActiveBoardSetId(rootDir)
  if (activeId) {
    const activeState = await loadBoardSetState(kind, activeId, undefined, kind === 'guide' ? rootDir : undefined, kind === 'prefilled-live' ? rootDir : '', kind === 'saved-live' ? rootDir : '')
    if (activeState.boards.length)
      return { id: activeId, state: activeState }
  }

  const sets = await listBoardSetKind(rootDir, kind)
  const firstSet = sets[0]
  if (!firstSet)
    return { id: 'default', state: { boards: [] } }

  await writeActiveBoardSetId(rootDir, firstSet.id)
  return {
    id: firstSet.id,
    state: await loadBoardSetState(kind, firstSet.id, undefined, kind === 'guide' ? rootDir : undefined, kind === 'prefilled-live' ? rootDir : '', kind === 'saved-live' ? rootDir : ''),
  }
}

export async function loadDefaultBoardSetState(
  rootDir: string | undefined,
  kind: BlackboardBoardSetKind,
): Promise<BlackboardPersistedState> {
  return (await loadDefaultBoardSetSelection(rootDir, kind)).state
}

export function boardSetRootDir(
  kind: BlackboardBoardSetKind,
  guideRootDir: string | undefined,
  prefilledLiveDir: string,
  savedLiveRootDir: string,
) {
  if (kind === 'guide')
    return guideRootDir
  if (kind === 'prefilled-live')
    return prefilledLiveDir
  if (kind === 'saved-live')
    return savedLiveRootDir

  return undefined
}

export async function activateBoardSet(
  kind: Exclude<BlackboardBoardSetKind, 'current-live'>,
  id: string,
  guideRootDir: string | undefined,
  prefilledLiveDir: string,
  savedLiveRootDir: string,
) {
  await writeActiveBoardSetId(boardSetRootDir(kind, guideRootDir, prefilledLiveDir, savedLiveRootDir), id)
}

export async function resetLiveFromPrefilled(
  persistDir: string | undefined,
  prefilledLiveDir: string,
  options: BlackboardSetupOptions,
  id = 'default',
) {
  const activeId = id === 'default'
    ? (await loadDefaultBoardSetSelection(prefilledLiveDir, 'prefilled-live')).id
    : id
  const prefilledState = await loadBoardSetState('prefilled-live', activeId, persistDir, undefined, prefilledLiveDir, '')
  if (!prefilledState.boards.length)
    return undefined

  await writeActiveBoardSetId(prefilledLiveDir, activeId)
  await writePersistedState(persistDir, {
    ...prefilledState,
    activeBoardId: prefilledState.activeBoardId || prefilledState.boards[0]?.id,
  }, options)
  return await loadPersistedState(persistDir)
}

export async function saveBoardSet(
  kind: Exclude<BlackboardBoardSetKind, 'current-live'>,
  rootDir: string | undefined,
  id: string | undefined,
  name: string | undefined,
  state: BlackboardPersistedState,
  options: BlackboardSetupOptions,
) {
  if (!rootDir)
    return undefined

  const now = Date.now()
  const trimmedName = name?.trim()
  const targetId = id && isSafeBoardSetId(id)
    ? id
    : await uniqueBoardSetId(rootDir, trimmedName || defaultBoardSetName(kind))
  const dir = path.join(rootDir, targetId)
  const existing = await loadPersistedState(dir)
  await writePersistedState(dir, {
    ...state,
    createdAt: existing.createdAt || state.createdAt || now,
    name: trimmedName || existing.name || defaultBoardSetName(kind),
    savedAt: now,
  }, options)

  const savedState = await loadPersistedState(dir)
  await writeActiveBoardSetId(rootDir, targetId)
  return {
    id: targetId,
    set: {
      active: true,
      boardCount: savedState.boards.length,
      id: targetId,
      key: boardSetKey(kind, targetId),
      kind,
      name: boardSetDisplayName(targetId, savedState, kind),
      savedAt: savedState.savedAt || savedState.createdAt,
    } satisfies BlackboardBoardSetSummary,
    state: savedState,
  }
}
