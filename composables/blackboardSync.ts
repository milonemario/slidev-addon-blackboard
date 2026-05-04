import type { Ref } from 'vue'
import type { BlackboardBoard, BlackboardBoardTheme } from '../shared/blackboardProtocol'

export type SyncType = 'presenter' | 'viewer'

export type BlackboardBoardSyncOperation =
  | {
    type: 'upsert'
    board: BlackboardBoard
    index: number
  }
  | {
    type: 'remove'
    boardId: string
  }

export interface BlackboardSyncState {
  activeBoardId?: string
  activeDrawing?: string
  boardOperation?: BlackboardBoardSyncOperation
  boardTheme?: BlackboardBoardTheme
  boards?: BlackboardBoard[]
  open?: boolean
  openClientId?: string
  openId?: string
  openSource?: SyncType
  openTime?: number
  stateId?: string
  stateSource?: SyncType
  stateTime?: number
}

export type BlackboardServerRef<T> = Ref<T | undefined> & {
  $patch?: (patch: Partial<T>) => Promise<boolean>
}

export function createSyncId(clientId: string, kind: 'open' | 'state') {
  return `${clientId}-${kind}-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function patchServerBlackboard(serverState: BlackboardServerRef<BlackboardSyncState>, patch: BlackboardSyncState) {
  serverState.value = {
    ...serverState.value,
    ...patch,
  }
}

export function shouldSendSyncCommand(isNotesViewer: boolean, isPrintMode: boolean) {
  return !isNotesViewer && !isPrintMode
}

export function shouldReceiveSyncCommand(isPrintMode: boolean) {
  return !isPrintMode
}

export function isFreshOpenSyncCommand(
  state: BlackboardSyncState,
  lastSentOpenId: string,
  lastAppliedOpenId: string,
  clientStartedAt: number,
) {
  return !!state.openId
    && state.openId !== lastSentOpenId
    && state.openId !== lastAppliedOpenId
    && state.open != null
    && typeof state.openTime === 'number'
    && state.openTime >= clientStartedAt
}

export function isFreshBoardSyncCommand(
  state: BlackboardSyncState,
  lastSentStateId: string,
  lastAppliedStateId: string,
  clientStartedAt: number,
) {
  return !!state.stateId
    && state.stateId !== lastSentStateId
    && state.stateId !== lastAppliedStateId
    && typeof state.stateTime === 'number'
    && state.stateTime >= clientStartedAt
}
