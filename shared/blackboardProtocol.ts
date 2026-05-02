export type BlackboardBoardTheme = 'blackboard' | 'whiteboard'
export type BlackboardExhibitKind = 'table' | 'mermaid' | 'image' | 'svg'
export type BlackboardExhibitPlacement = 'exploded' | 'locked'
export type BlackboardBoardSetKind = 'current-live' | 'guide' | 'prefilled-live' | 'saved-live'

export interface BlackboardExportOptions {
  include: boolean
  background: BlackboardBoardTheme
}

export interface BlackboardBuildOptions {
  append: boolean
  background: BlackboardBoardTheme
}

export interface BlackboardBoard {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  drawing: string
  guideBoardId?: string | null
}

export interface BlackboardPersistedState {
  activeBoardId?: string
  boards: BlackboardBoard[]
  createdAt?: number
  name?: string
  savedAt?: number
  theme?: BlackboardBoardTheme
}

export interface BlackboardBoardSetSummary {
  active?: boolean
  boardCount: number
  id: string
  key: string
  kind: BlackboardBoardSetKind
  name: string
  savedAt?: number
}

export interface BlackboardExhibit {
  id: string
  title: string
  category?: string
  kind?: BlackboardExhibitKind
}

export interface BlackboardRenderedExhibit extends BlackboardExhibit {
  kind: BlackboardExhibitKind
  placement?: BlackboardExhibitPlacement
  width: number
  height: number
  svg: string
}

export interface BlackboardMermaidSourceExhibit extends BlackboardExhibit {
  kind: 'mermaid'
  source: string
}

export interface BlackboardSvgSourceExhibit extends BlackboardExhibit {
  kind: 'svg'
  source: string
}

export interface BlackboardPlacementRect {
  x: number
  y: number
  width: number
  height: number
}

export interface BlackboardPoint {
  x: number
  y: number
}

export interface BlackboardInitialState {
  activeBoardId?: string
  boardSets?: {
    endpoint?: string
    resetEndpoint?: string
  }
  boards?: BlackboardBoard[]
  build?: BlackboardBuildOptions
  enabled?: boolean
  endpoint?: string
  exhibitEndpoint?: string
  exhibits?: BlackboardExhibit[]
  export?: boolean | Partial<BlackboardExportOptions>
  guide?: {
    enabled?: boolean
    endpoint?: string
    opacity?: number
  }
  guideActiveBoardId?: string
  guideActiveSetId?: string
  guideBoards?: BlackboardBoard[]
  persist?: boolean
  theme?: BlackboardBoardTheme
}

export interface BlackboardBoardSetListResponse {
  sets?: BlackboardBoardSetSummary[]
}

export const BLACKBOARD_VIRTUAL_ID = 'virtual:slidev-blackboard'
export const BLACKBOARD_STATE_ENDPOINT = '/@slidev-blackboard/state'
export const BLACKBOARD_GUIDES_ENDPOINT = '/@slidev-blackboard/guides'
export const BLACKBOARD_BOARD_SETS_ENDPOINT = '/@slidev-blackboard/sets'
export const BLACKBOARD_RESET_LIVE_ENDPOINT = '/@slidev-blackboard/reset-live'
export const BLACKBOARD_EXHIBITS_ENDPOINT = '/@slidev-blackboard/exhibits'
export const BLACKBOARD_EXHIBIT_ASSET_ENDPOINT = '/@slidev-blackboard/exhibit-asset'

export function normalizeBoardTheme(theme: unknown): BlackboardBoardTheme {
  return theme === 'whiteboard' ? 'whiteboard' : 'blackboard'
}

export function normalizeBlackboardExportBackground(background: unknown): BlackboardBoardTheme {
  if (background === 'white' || background === 'whiteboard')
    return 'whiteboard'
  if (background === 'black' || background === 'blackboard')
    return 'blackboard'

  return 'whiteboard'
}

export function normalizeBlackboardExportOptions(raw: unknown): BlackboardExportOptions {
  if (raw === true) {
    return {
      background: 'whiteboard',
      include: true,
    }
  }

  if (raw && typeof raw === 'object') {
    const config = raw as Record<string, unknown>
    return {
      background: normalizeBlackboardExportBackground(config.background),
      include: config.include === true,
    }
  }

  return {
    background: 'whiteboard',
    include: false,
  }
}

export function normalizeBlackboardBuildOptions(raw: unknown, exportOptions: BlackboardExportOptions): BlackboardBuildOptions {
  if (raw === true) {
    return {
      append: true,
      background: exportOptions.background,
    }
  }

  if (raw && typeof raw === 'object') {
    const config = raw as Record<string, unknown>
    return {
      append: config.append === true || config.include === true,
      background: normalizeBlackboardExportBackground(config.background ?? exportOptions.background),
    }
  }

  return {
    append: false,
    background: exportOptions.background,
  }
}

export function boardSetKey(kind: BlackboardBoardSetKind, id: string) {
  return kind === 'current-live' ? 'current' : `${kind}:${id}`
}

export function parseBoardSetKey(key: string): { id: string, kind: BlackboardBoardSetKind } | undefined {
  if (key === 'current')
    return { id: 'current', kind: 'current-live' }

  const separator = key.indexOf(':')
  if (separator < 0)
    return undefined

  const kind = key.slice(0, separator) as BlackboardBoardSetKind
  const id = key.slice(separator + 1)
  if (!['guide', 'prefilled-live', 'saved-live'].includes(kind) || !id)
    return undefined

  return { id, kind }
}

export function boardSetFallbackName(id: string) {
  return id
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    || 'guide set'
}
