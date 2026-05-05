import type { BlackboardBoard, BlackboardPersistedState } from '../shared/blackboardProtocol'
import { loadPersistedState } from './blackboardStateStore'

export function stateWithLoadedBoards(
  state: BlackboardPersistedState,
  boardIds: string[],
): BlackboardPersistedState {
  const loadedIds = new Set(boardIds.filter(Boolean))
  return {
    ...state,
    boards: (state.boards || []).map((board): BlackboardBoard => loadedIds.has(board.id)
      ? board
      : { ...board, drawing: '' }),
    loadedBoardIds: Array.from(loadedIds),
  }
}

export function stateWithActiveBoardOnly(state: BlackboardPersistedState) {
  const activeId = state.activeBoardId || state.boards?.[0]?.id || ''
  return stateWithLoadedBoards(state, activeId ? [activeId] : [])
}

export function stateWithSingleBoard(state: BlackboardPersistedState, boardId: string) {
  return stateWithLoadedBoards(state, boardId ? [boardId] : [])
}

export async function mergeUnloadedBoards(
  existingDir: string | undefined,
  state: BlackboardPersistedState,
) {
  if (!existingDir || !state.loadedBoardIds)
    return state

  const loadedIds = new Set(state.loadedBoardIds)
  const existingState = await loadPersistedState(existingDir)
  const existingById = new Map(existingState.boards.map(board => [board.id, board]))
  return {
    ...state,
    boards: state.boards.map((board) => {
      if (loadedIds.has(board.id))
        return board

      const existing = existingById.get(board.id)
      return existing
        ? { ...board, drawing: existing.drawing }
        : board
    }),
  }
}
