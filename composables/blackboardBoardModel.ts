import type { BlackboardBoard } from '../shared/blackboardProtocol'
import { normalizeDrawingColors } from './svgExhibitPlacement'

export function createBoard(index: number, drawing = '', guideBoardId?: string | null): BlackboardBoard {
  const now = Date.now()
  const board: BlackboardBoard = {
    id: `board-${now}-${Math.random().toString(36).slice(2)}`,
    title: `Board ${index}`,
    createdAt: now,
    updatedAt: now,
    drawing,
  }

  if (guideBoardId !== undefined)
    board.guideBoardId = guideBoardId

  return board
}

export function cloneBoards(boards: BlackboardBoard[] | undefined): BlackboardBoard[] {
  if (!boards?.length)
    return []

  return boards.map((board, index) => ({
    id: board.id || `board-${index + 1}`,
    title: board.title || `Board ${index + 1}`,
    createdAt: board.createdAt || Date.now(),
    updatedAt: board.updatedAt || board.createdAt || Date.now(),
    drawing: normalizeDrawingColors(board.drawing || ''),
    guideBoardId: typeof board.guideBoardId === 'string' || board.guideBoardId === null
      ? board.guideBoardId
      : undefined,
  }))
}

export function renumberDefaultBoardTitles(boards: BlackboardBoard[]) {
  return boards.map((board, index) => ({
    ...board,
    title: /^Board \d+$/.test(board.title) ? `Board ${index + 1}` : board.title,
  }))
}

export function alignBoardPairs(liveBoardsInput: BlackboardBoard[], guideBoardsInput: BlackboardBoard[]) {
  const liveBoards = cloneBoards(liveBoardsInput)
  const guideBoards = cloneBoards(guideBoardsInput)
  const count = Math.max(liveBoards.length, guideBoards.length, 1)

  while (guideBoards.length < count)
    guideBoards.push(createBoard(guideBoards.length + 1))

  while (liveBoards.length < count) {
    const guide = guideBoards[liveBoards.length]
    liveBoards.push(createBoard(liveBoards.length + 1, '', guide?.id))
  }

  const guideIds = new Set(guideBoards.map(board => board.id))
  return {
    liveBoards: renumberDefaultBoardTitles(liveBoards.map((board, index) => {
      const guide = guideBoards[index]
      if (!guide)
        return board

      if (board.guideBoardId && guideIds.has(board.guideBoardId))
        return board

      return { ...board, guideBoardId: guide.id }
    })),
    guideBoards: renumberDefaultBoardTitles(guideBoards),
  }
}

export function boardHasDrawing(board: BlackboardBoard) {
  return board.drawing.trim().length > 0
}
