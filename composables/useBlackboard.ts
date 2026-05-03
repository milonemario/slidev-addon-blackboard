import type { Brush, DrawingMode, Options as DrauuOptions } from 'drauu'
import { lockShortcuts, slideHeight, slideWidth, useNav } from '@slidev/client'
import { createDrauu } from 'drauu'
import { computed, markRaw, reactive, ref, watch } from 'vue'
import type {
  BlackboardBoard,
  BlackboardBoardSetKind,
  BlackboardBoardSetSummary,
  BlackboardBoardTheme,
  BlackboardExhibit,
  BlackboardInitialState,
  BlackboardPlacementRect,
  BlackboardPoint,
  BlackboardRenderedExhibit,
} from '../shared/blackboardProtocol'
import {
  BLACKBOARD_BOARD_SETS_ENDPOINT,
  BLACKBOARD_EXHIBITS_ENDPOINT,
  BLACKBOARD_GUIDES_ENDPOINT,
  BLACKBOARD_RESET_LIVE_ENDPOINT,
  BLACKBOARD_STATE_ENDPOINT,
  boardSetFallbackName,
  normalizeBlackboardExportOptions,
  normalizeBoardTheme,
  parseBoardSetKey,
} from '../shared/blackboardProtocol'
import {
  alignBoardPairs,
  boardHasDrawing,
  cloneBoards,
  createBoard,
  renumberDefaultBoardTitles,
} from './blackboardBoardModel'
import {
  fetchBoardSet,
  fetchBoardSets,
  deleteBoardSet as deleteBoardSetFromApi,
  loadExhibitPayload as loadExhibitPayloadFromApi,
  postJson,
  resetLiveBoardSet,
  saveBoardSet,
} from './blackboardClientApi'
import {
  currentDrauuDrawing,
  loadDrauuDrawing,
  refreshEraserFragments,
  reindexDrauuElements,
} from './blackboardDrauuAdapter'
import { eraserIntersectingExhibits } from './blackboardEraserGeometry'
import {
  blackboardStoragePrefix,
  readStoredValue,
  storedReactive,
  storedRef,
  writeStoredValue,
} from './blackboardStorage'
import type { BlackboardServerRef, BlackboardSyncState, SyncType } from './blackboardSync'
import {
  createSyncId,
  isFreshBoardSyncCommand as isFreshBoardSyncCommandFromState,
  isFreshOpenSyncCommand as isFreshOpenSyncCommandFromState,
  patchServerBlackboard as patchServerBlackboardRef,
  shouldReceiveSyncCommand as canReceiveSyncCommand,
  shouldSendSyncCommand as canSendSyncCommand,
} from './blackboardSync'
import { placeImageExhibitSvg } from './imageExhibits'
import { placeMermaidExhibitSvg } from './mermaidExhibits'
import { placeSvgExhibitSvg } from './svgFileExhibits'
import {
  normalizeDrawingColors,
  normalizeExhibitKind,
  normalizePrimaryColor,
  primaryBrushColor,
  roundBoardNumber,
  whiteboardPrimaryColor,
} from './svgExhibitPlacement'
import { placeTableExhibitSvg } from './tableExhibits'
// @ts-expect-error - Slidev/Vite provides this virtual ref at runtime.
import serverBlackboardState from 'server-ref:slidevBlackboard'
// @ts-expect-error - The addon provides this virtual module from setup/vite-plugins.ts.
import blackboardInitialState from 'virtual:slidev-blackboard'

type BlackboardToolMode = DrawingMode | 'arrow'
type BlackboardEditMode = 'live' | 'guide'

export type {
  BlackboardBoard,
  BlackboardExhibit,
  BlackboardPlacementRect,
  BlackboardPoint,
  BlackboardRenderedExhibit,
}

const initialState = blackboardInitialState as BlackboardInitialState
const blackboardsEnabled = initialState.enabled !== false
const persistedBoardsEnabled = blackboardsEnabled && !!initialState.persist
const persistenceEndpoint = initialState.endpoint || BLACKBOARD_STATE_ENDPOINT
const exhibitEndpoint = initialState.exhibitEndpoint || BLACKBOARD_EXHIBITS_ENDPOINT
const guideEndpoint = initialState.guide?.endpoint || BLACKBOARD_GUIDES_ENDPOINT
const boardSetsEndpoint = initialState.boardSets?.endpoint || BLACKBOARD_BOARD_SETS_ENDPOINT
const resetLiveEndpoint = initialState.boardSets?.resetEndpoint || BLACKBOARD_RESET_LIVE_ENDPOINT
const guidesEnabled = blackboardsEnabled && !!initialState.guide?.enabled
const initialExportOptions = normalizeBlackboardExportOptions(blackboardsEnabled ? initialState.export : false)
const buildAppendixOptions = initialState.build || {
  append: false,
  background: initialExportOptions.background,
}
const blackboardDrawingInputTypes: NonNullable<DrauuOptions['acceptsInputTypes']> = ['mouse', 'pen']
const noBlackboardInputTypes: NonNullable<DrauuOptions['acceptsInputTypes']> = []

function alertAction(message: string) {
  if (typeof window !== 'undefined')
    window.alert(message)
}

function placedExhibitSvg(svg: string, x: number, y: number, scale: number, exhibit: BlackboardRenderedExhibit) {
  const kind = normalizeExhibitKind(exhibit.kind)
  if (kind === 'image')
    return placeImageExhibitSvg(svg, x, y, scale, exhibit)
  if (kind === 'mermaid')
    return placeMermaidExhibitSvg(svg, x, y, scale, exhibit)
  if (kind === 'svg')
    return placeSvgExhibitSvg(svg, x, y, scale, exhibit)

  return placeTableExhibitSvg(svg, x, y, scale, exhibit)
}

let blackboardState: ReturnType<typeof createBlackboard> | undefined

function createBlackboard() {
  const prefix = blackboardStoragePrefix()
  const {
    currentSlideNo,
    isNotesViewer,
    isPresenter,
    isPrintMode,
  } = useNav()

  const brushColors = [
    primaryBrushColor,
    '#9ca3af',
    '#ffe066',
    '#74c0fc',
    '#ff8787',
    '#8ce99a',
  ]

    const storedBoards = readStoredValue<BlackboardBoard[]>(`${prefix}:boards`, [])
    const legacyDrawing = normalizeDrawingColors(readStoredValue(`${prefix}:drawing`, ''))
    const initialBoards = cloneBoards(initialState.boards)
    const initialGuideBoards = cloneBoards(initialState.guideBoards)
    const localBoards = cloneBoards(storedBoards)
  const fallbackBoards = localBoards.length
    ? localBoards
    : [createBoard(1, legacyDrawing)]
    const initialLiveBoards = persistedBoardsEnabled && initialBoards.length
      ? initialBoards
      : fallbackBoards
    const initialGuides = guidesEnabled
      ? initialGuideBoards
      : []
    const alignedInitialBoards = guidesEnabled && initialGuides.length
      ? alignBoardPairs(initialLiveBoards, initialGuides)
      : { liveBoards: initialLiveBoards, guideBoards: initialGuides }

  const boards = ref<BlackboardBoard[]>(
    alignedInitialBoards.liveBoards,
  )
    const activeBoardId = ref(
      (persistedBoardsEnabled && initialState.activeBoardId)
      || readStoredValue(`${prefix}:active-board`, '')
      || boards.value[0]?.id
      || '',
    )
    const guideBoards = ref<BlackboardBoard[]>(
      alignedInitialBoards.guideBoards,
    )
    const activeGuideBoardId = ref(
      (guidesEnabled && initialState.guideActiveBoardId)
      || readStoredValue(`${prefix}:active-guide-board`, '')
      || guideBoards.value[0]?.id
      || '',
    )
    const activeGuideSetId = storedRef(`${prefix}:active-guide-set`, initialState.guideActiveSetId || 'default')
    const isOpen = ref(false)
    const toolbarVisible = storedRef(`${prefix}:toolbar`, true)
    const exportBlackboards = ref(initialExportOptions.include)
    const exportBlackboardSetId = storedRef(`${prefix}:export-set`, 'current')
    const exportBlackboardTheme = ref<BlackboardBoardTheme>(initialExportOptions.background)
    const boardTheme = storedRef<BlackboardBoardTheme>(`${prefix}:theme`, normalizeBoardTheme(initialState.theme))
    if (persistedBoardsEnabled)
      boardTheme.value = normalizeBoardTheme(initialState.theme)
    const guideOpacity = storedRef(`${prefix}:guide-opacity`, initialState.guide?.opacity ?? 0.22)
    const blackboardEditMode = storedRef<BlackboardEditMode>(`${prefix}:edit-mode`, 'live')
    if (blackboardEditMode.value !== 'guide')
      blackboardEditMode.value = 'live'
    if (!guidesEnabled)
      blackboardEditMode.value = 'live'
    const exhibitPickerVisible = storedRef(`${prefix}:exhibit-picker`, false)
    const drawingMode = storedRef<BlackboardToolMode>(`${prefix}:mode`, 'stylus')
  const brush = storedReactive<Brush>(`${prefix}:brush`, {
    color: brushColors[0],
    fill: 'transparent',
    mode: 'stylus',
    size: 7,
  })
  brush.color = normalizePrimaryColor(brush.color || primaryBrushColor)

  const canClear = ref(false)
    const canRedo = ref(false)
    const canUndo = ref(false)
    const exhibits = ref<BlackboardExhibit[]>(initialState.exhibits || [])
    const exportBlackboardSets = ref<BlackboardBoardSetSummary[]>([{
      boardCount: boards.value.length,
      id: 'current',
      key: 'current',
      kind: 'current-live',
      name: 'Current live blackboards',
    }])
    const exportBlackboardSetBoards = ref<BlackboardBoard[]>([])
    const pendingExhibit = ref<BlackboardRenderedExhibit>()
    const isDrawing = ref(false)
    const clientStartedAt = Date.now()
    const serverState = serverBlackboardState as BlackboardServerRef<BlackboardSyncState>
    let isLoading = false
    let lastDrawingMode: BlackboardToolMode = drawingMode.value === 'eraseLine' ? 'stylus' : drawingMode.value
    let lastAppliedOpenId = serverState.value?.openId || ''
    let lastAppliedStateId = serverState.value?.stateId || ''
    let lastSentOpenId = ''
    let lastSentStateId = ''
    let openSyncCleanupTimer: ReturnType<typeof setTimeout> | undefined
    let persistTimer: ReturnType<typeof setTimeout> | undefined
    let guidePersistTimer: ReturnType<typeof setTimeout> | undefined
    let releaseShortcutLock: (() => void) | undefined
    let keydownHandler: ((event: KeyboardEvent) => void) | undefined

    const clientId = typeof window === 'undefined'
      ? 'server'
      : `${window.location.origin}-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const syncType = computed<SyncType>(() => isPresenter.value ? 'presenter' : 'viewer')
    const canEditGuides = computed(() => blackboardsEnabled && guidesEnabled && isPresenter.value && !isNotesViewer.value && !isPrintMode.value)
    const editMode = computed<BlackboardEditMode>(() => (
      blackboardEditMode.value === 'guide' && canEditGuides.value
        ? 'guide'
        : 'live'
    ))
    const canEdit = computed(() => {
      if (!blackboardsEnabled || !isOpen.value)
        return false

      const openClientId = serverState.value?.openClientId
      return openClientId == null || openClientId === clientId
    })
    const activeLiveBoard = computed(() => {
      const existing = boards.value.find(board => board.id === activeBoardId.value)
      return existing || boards.value[0]
    })
    const activeGuideBoard = computed(() => {
      const existing = guideBoards.value.find(board => board.id === activeGuideBoardId.value)
      return existing || guideBoards.value[0]
    })
    const activeBoard = computed(() => editMode.value === 'guide' ? activeGuideBoard.value : activeLiveBoard.value)
    const activeLiveBoardIndex = computed(() => {
      const index = boards.value.findIndex(board => board.id === activeLiveBoard.value?.id)
      return index < 0 ? 0 : index
    })
    const activeGuideBoardIndex = computed(() => {
      const index = guideBoards.value.findIndex(board => board.id === activeGuideBoard.value?.id)
      return index < 0 ? 0 : index
    })
    const activeBoardIndex = computed(() => {
      return editMode.value === 'guide' ? activeGuideBoardIndex.value : activeLiveBoardIndex.value
    })
    const boardCount = computed(() => editMode.value === 'guide' ? guideBoards.value.length : boards.value.length)
    const canGoPreviousBoard = computed(() => activeBoardIndex.value > 0)
    const canGoNextBoard = computed(() => activeBoardIndex.value < boardCount.value - 1)
    const drawingData = computed(() => activeBoard.value?.drawing || '')
    const exportBlackboardSourceBoards = computed(() => (
      exportBlackboardSetId.value === 'current'
        ? boards.value
        : exportBlackboardSetBoards.value
    ))
    const exportableBoards = computed(() => exportBlackboardSourceBoards.value.filter(boardHasDrawing))
    const buildAppendixBoards = computed(() => (
      blackboardsEnabled && buildAppendixOptions.append
        ? boards.value.filter(boardHasDrawing)
        : []
    ))
    const canExportBlackboards = computed(() => blackboardsEnabled && exportableBoards.value.length > 0)
    const isAutomatedPrintExport = computed(() => (
      typeof window !== 'undefined'
      && new URLSearchParams(window.location.search).has('print')
    ))
    const printExportBlackboards = computed(() => (
      blackboardsEnabled
      && (
        isAutomatedPrintExport.value
          ? initialExportOptions.include
          : exportBlackboards.value
      )
    ))
    const printExportBlackboardTheme = computed(() => (
      isAutomatedPrintExport.value
        ? initialExportOptions.background
        : normalizeBoardTheme(exportBlackboardTheme.value)
    ))
    const liveReferenceBoard = computed(() => liveBoardForGuideBoard(activeGuideBoard.value, activeGuideBoardIndex.value))
    const guideReferenceBoard = computed(() => guideBoardForLiveBoard(activeLiveBoard.value, activeLiveBoardIndex.value))
    const referenceBoard = computed(() => editMode.value === 'guide' ? liveReferenceBoard.value : guideReferenceBoard.value)
    const referenceLayerVisible = computed(() => canEditGuides.value && isOpen.value && !!referenceBoard.value?.drawing.trim())
    const referenceControlsVisible = computed(() => referenceLayerVisible.value && canEdit.value)
    const removalLiveBoard = computed(() => editMode.value === 'guide' ? liveReferenceBoard.value : activeLiveBoard.value)
    const removalGuideBoard = computed(() => (
      guidesEnabled
        ? editMode.value === 'guide' ? activeGuideBoard.value : guideReferenceBoard.value
        : undefined
    ))
    const canRemoveBoard = computed(() => (
      (!!removalLiveBoard.value || !!removalGuideBoard.value)
      && (!removalLiveBoard.value || boards.value.length > 1)
      && (!removalGuideBoard.value || guideBoards.value.length > 1)
    ))
    const canSaveGuides = computed(() => canEditGuides.value)
    const canSavePrefilledLiveBoards = computed(() => blackboardsEnabled && persistedBoardsEnabled && !isNotesViewer.value && !isPrintMode.value)
    const canShowExhibits = computed(() => blackboardsEnabled && isOpen.value && canEdit.value && !isPrintMode.value && exhibits.value.length > 0)
    const hasGuideBoards = computed(() => guidesEnabled && guideBoards.value.length > 0)
    const activeGuideSetName = computed(() => {
      const activeSet = exportBlackboardSets.value.find(set => set.kind === 'guide' && set.id === activeGuideSetId.value)
        || exportBlackboardSets.value.find(set => set.kind === 'guide' && set.active)

      if (!activeSet && !guideBoards.value.length)
        return 'New guides'

      return activeSet?.name || boardSetFallbackName(activeGuideSetId.value)
    })
    const canvasWidth = computed(() => slideWidth.value || 1400)
    const canvasHeight = computed(() => slideHeight.value || 1000)

  const drauuOptions: DrauuOptions = reactive({
    brush,
    acceptsInputTypes: computed(() => (blackboardsEnabled && isOpen.value && canEdit.value && !pendingExhibit.value) ? blackboardDrawingInputTypes : noBlackboardInputTypes),
  })
  const drauu = markRaw(createDrauu(drauuOptions))
  const isSyncedOpen = computed(() => blackboardsEnabled && isOpen.value)
  const boardThemeClass = computed(() => `slidev-blackboard--${boardTheme.value}`)
  const buildAppendixBlackboardThemeClass = computed(() => `slidev-blackboard--${buildAppendixOptions.background}`)
  const exportBlackboardThemeClass = computed(() => `slidev-blackboard--${exportBlackboardTheme.value}`)
  const printExportBlackboardThemeClass = computed(() => `slidev-blackboard--${printExportBlackboardTheme.value}`)
  const nextBoardTheme = computed<BlackboardBoardTheme>(() => boardTheme.value === 'whiteboard' ? 'blackboard' : 'whiteboard')

  function displayBrushColor(color: string) {
    const normalized = normalizePrimaryColor(color)
    return boardTheme.value === 'whiteboard' && normalized.toLowerCase() === primaryBrushColor
      ? whiteboardPrimaryColor
      : normalized
  }

  function updateState() {
    canRedo.value = drauu.canRedo()
    canUndo.value = drauu.canUndo()
    canClear.value = !!drauu.el?.children.length
  }

    function writeLocalBoardState() {
      writeStoredValue(`${prefix}:boards`, boards.value)
      writeStoredValue(`${prefix}:active-board`, activeBoardId.value)
    }

    function writeLocalGuideState() {
      writeStoredValue(`${prefix}:active-guide-board`, activeGuideBoardId.value)
    }

    function boardsForMode(mode: BlackboardEditMode) {
      return mode === 'guide' ? guideBoards.value : boards.value
    }

    function activeBoardForMode(mode: BlackboardEditMode) {
      return mode === 'guide' ? activeGuideBoard.value : activeLiveBoard.value
    }

    function activeBoardIdForMode(mode: BlackboardEditMode) {
      return mode === 'guide' ? activeGuideBoardId.value : activeBoardId.value
    }

    function persistedState(nextBoards: BlackboardBoard[], nextActiveBoardId: string | undefined, includeTheme = false) {
      return {
        activeBoardId: nextActiveBoardId,
        boards: cloneBoards(nextBoards),
        ...(includeTheme ? { theme: boardTheme.value } : {}),
      }
    }

    function persistedLiveState(nextBoards = liveBoardsWithCurrentDrawing(), nextActiveBoardId = activeBoardId.value) {
      return persistedState(nextBoards, nextActiveBoardId, true)
    }

    function persistedGuideState(nextBoards = guideBoardsWithCurrentDrawing(), nextActiveBoardId = activeGuideBoardId.value) {
      return persistedState(nextBoards, nextActiveBoardId)
    }

    function persistLiveBoardState() {
      if (!persistedBoardsEnabled || typeof window === 'undefined' || isNotesViewer.value || isPrintMode.value)
        return

      if (persistTimer)
        clearTimeout(persistTimer)

    persistTimer = setTimeout(async () => {
      try {
        await fetch(persistenceEndpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(persistedLiveState()),
          })
        }
        catch (error) {
          console.warn('[blackboard] Failed to persist boards', error)
        }
      }, 150)
    }

    function persistGuideBoardState() {
      if (!guidesEnabled || typeof window === 'undefined' || isNotesViewer.value || isPrintMode.value)
        return

      if (guidePersistTimer)
        clearTimeout(guidePersistTimer)

      guidePersistTimer = setTimeout(async () => {
        try {
          await postJson(`${guideEndpoint}?id=${encodeURIComponent(activeGuideSetId.value || 'default')}`, {
            ...persistedGuideState(),
            id: activeGuideSetId.value || 'default',
          })
        }
        catch (error) {
          console.warn('[blackboard] Failed to persist guides', error)
        }
      }, 150)
    }

  function patchServerBlackboard(patch: BlackboardSyncState) {
    patchServerBlackboardRef(serverState, patch)
  }

    function syncBoardState() {
      if (!shouldSendSyncCommand())
        return

      const id = createSyncId(clientId, 'state')
      const currentBoards = liveBoardsWithCurrentDrawing()
      lastSentStateId = id
      patchServerBlackboard({
        activeBoardId: activeBoardId.value,
        activeDrawing: editMode.value === 'live' && drauu.mounted ? currentDrauuDrawing(drauu) : activeLiveBoard.value?.drawing || '',
        boardTheme: boardTheme.value,
        boards: cloneBoards(currentBoards),
        stateId: id,
      stateSource: syncType.value,
      stateTime: Date.now(),
    })
  }

    function commitLiveBoards(
      nextBoards: BlackboardBoard[],
      nextActiveBoardId = activeBoardId.value,
      options: { load?: boolean, persist?: boolean, sync?: boolean } = {},
  ) {
    const normalized = renumberDefaultBoardTitles(cloneBoards(nextBoards))
    if (!normalized.length)
      normalized.push(createBoard(1))

    const targetId = normalized.some(board => board.id === nextActiveBoardId)
      ? nextActiveBoardId
      : normalized[0].id

    boards.value = normalized
      activeBoardId.value = targetId
      writeLocalBoardState()

      if (options.load && editMode.value === 'live')
        loadDrawing(activeLiveBoard.value?.drawing || '')
      if (options.persist)
        persistLiveBoardState()
      if (options.sync)
        syncBoardState()
    }

    function commitGuideBoards(
      nextBoards: BlackboardBoard[],
      nextActiveBoardId = activeGuideBoardId.value,
      options: { load?: boolean, persist?: boolean } = {},
    ) {
      if (!guidesEnabled)
        return

      const normalized = renumberDefaultBoardTitles(cloneBoards(nextBoards))
      if (!normalized.length)
        normalized.push(createBoard(1))

      const targetId = normalized.some(board => board.id === nextActiveBoardId)
        ? nextActiveBoardId
        : normalized[0].id

      guideBoards.value = normalized
      activeGuideBoardId.value = targetId
      writeLocalGuideState()

      if (options.load && editMode.value === 'guide')
        loadDrawing(activeGuideBoard.value?.drawing || '')
      if (options.persist)
        persistGuideBoardState()
    }

    function commitBoardsForMode(
      mode: BlackboardEditMode,
      nextBoards: BlackboardBoard[],
      nextActiveBoardId = activeBoardIdForMode(mode),
      options: { load?: boolean, persist?: boolean, sync?: boolean } = {},
    ) {
      if (mode === 'guide')
        commitGuideBoards(nextBoards, nextActiveBoardId, options)
      else
        commitLiveBoards(nextBoards, nextActiveBoardId, options)
    }

    function updateActiveBoardDrawing(drawing: string) {
      const mode = editMode.value
      const active = activeBoardForMode(mode)
      if (!active)
        return

      const now = Date.now()
      commitBoardsForMode(
        mode,
        boardsForMode(mode).map(board => board.id === active.id
          ? { ...board, drawing, updatedAt: now }
          : board),
        activeBoardIdForMode(mode),
        { persist: true, sync: mode === 'live' },
      )
    }

    function boardsWithCurrentDrawing(mode = editMode.value) {
      const active = activeBoardForMode(mode)
      if (mode !== editMode.value || !drauu.mounted || isLoading || !active)
        return boardsForMode(mode)

      const drawing = currentDrauuDrawing(drauu)
      if (drawing === active.drawing)
        return boardsForMode(mode)

      const now = Date.now()
      return boardsForMode(mode).map(board => board.id === active.id
        ? { ...board, drawing, updatedAt: now }
        : board)
    }

    function liveBoardsWithCurrentDrawing() {
      return boardsWithCurrentDrawing('live')
    }

    function guideBoardsWithCurrentDrawing() {
      return boardsWithCurrentDrawing('guide')
    }

  function loadDrawing(svg: string) {
    if (!drauu.mounted) {
      updateState()
      return
    }

    isLoading = true
    loadDrauuDrawing(drauu, svg)
    refreshEraserFragments(drauu, drawingMode.value)
    updateState()
    isLoading = false
  }

  function load() {
    loadDrawing(drawingData.value)
  }

    function save() {
      updateState()
      if (isLoading)
        return

    updateActiveBoardDrawing(currentDrauuDrawing(drauu))
  }

  function clear() {
    loadDrawing('')
    updateActiveBoardDrawing('')
  }

  function undo() {
    drauu.undo()
    save()
  }

    function redo() {
      drauu.redo()
      save()
    }

    function guideBoardForLiveBoard(liveBoard: BlackboardBoard | undefined, index: number) {
      if (!liveBoard)
        return undefined

      if (liveBoard.guideBoardId) {
        const linked = guideBoards.value.find(board => board.id === liveBoard.guideBoardId)
        if (linked)
          return linked
      }

      return guideBoards.value[index]
    }

    function liveBoardForGuideBoard(guideBoard: BlackboardBoard | undefined, index: number) {
      if (!guideBoard)
        return undefined

      return boards.value.find(board => board.guideBoardId === guideBoard.id) || boards.value[index]
    }

    function ensureGuideBoardAt(index: number) {
      if (!guidesEnabled)
        return undefined

      const targetIndex = Math.max(0, index)
      const nextBoards = [...guideBoards.value]
      while (nextBoards.length <= targetIndex)
        nextBoards.push(createBoard(nextBoards.length + 1))

      const target = nextBoards[targetIndex]
      commitGuideBoards(nextBoards, target.id)
      return target
    }

    function selectGuideForLiveBoard() {
      const target = guideBoardForLiveBoard(activeLiveBoard.value, activeLiveBoardIndex.value)
        || ensureGuideBoardAt(activeLiveBoardIndex.value)
      if (!target)
        return

      activeGuideBoardId.value = target.id
      writeLocalGuideState()
    }

    function selectLiveForGuideBoard() {
      const target = liveBoardForGuideBoard(activeGuideBoard.value, activeGuideBoardIndex.value)
      if (!target)
        return

      commitLiveBoards(liveBoardsWithCurrentDrawing(), target.id, { persist: true, sync: true })
    }

    function setBlackboardEditMode(mode: BlackboardEditMode) {
      const nextMode = mode === 'guide' && canEditGuides.value ? 'guide' : 'live'
      if (nextMode === editMode.value)
        return

      save()
      pendingExhibit.value = undefined
      if (nextMode === 'guide')
        selectGuideForLiveBoard()
      else
        selectLiveForGuideBoard()

      blackboardEditMode.value = nextMode
      load()
    }

    async function loadBlackboardSet(key: string, activate = false) {
      if (key === 'current')
        return persistedLiveState()

      const parsed = parseBoardSetKey(key)
      if (!parsed)
        throw new Error('Invalid blackboard set')

      return await fetchBoardSet(boardSetsEndpoint, key, activate)
    }

    async function loadExportBlackboardSet(key = exportBlackboardSetId.value) {
      if (key === 'current') {
        exportBlackboardSetBoards.value = []
        return
      }

      try {
        const state = await loadBlackboardSet(key)
        exportBlackboardSetBoards.value = cloneBoards(state.boards)
      }
      catch (error) {
        console.warn('[blackboard] Failed to load export blackboard set', error)
        exportBlackboardSetId.value = 'current'
        exportBlackboardSetBoards.value = []
      }
    }

    async function loadExportBlackboardSets() {
      try {
        const response = await fetchBoardSets(boardSetsEndpoint)
        exportBlackboardSets.value = response.sets || []
        if (!exportBlackboardSets.value.some(set => set.key === exportBlackboardSetId.value))
          exportBlackboardSetId.value = 'current'
        await loadExportBlackboardSet(exportBlackboardSetId.value)
      }
      catch (error) {
        console.warn('[blackboard] Failed to load export blackboard sets', error)
        exportBlackboardSets.value = [{
          boardCount: boards.value.length,
          id: 'current',
          key: 'current',
          kind: 'current-live',
          name: 'Current live blackboards',
        }]
        exportBlackboardSetId.value = 'current'
        exportBlackboardSetBoards.value = []
      }
    }

    async function setExportBlackboardSet(key: string) {
      exportBlackboardSetId.value = key
      await loadExportBlackboardSet(key)
    }

    function setExportBlackboardTheme(theme: BlackboardBoardTheme) {
      exportBlackboardTheme.value = normalizeBoardTheme(theme)
    }

    async function deleteBlackboardSet(key: string) {
      const parsed = parseBoardSetKey(key)
      if (!parsed || parsed.kind === 'current-live')
        return false

      try {
        const response = await deleteBoardSetFromApi(boardSetsEndpoint, key)
        exportBlackboardSets.value = response.sets || []

        if (exportBlackboardSetId.value === key) {
          exportBlackboardSetId.value = 'current'
          exportBlackboardSetBoards.value = []
        }

        if (parsed.kind === 'guide' && activeGuideSetId.value === parsed.id) {
          activeGuideSetId.value = exportBlackboardSets.value.find(set => set.kind === 'guide' && set.active)?.id || 'default'
          guideBoards.value = []
          activeGuideBoardId.value = ''
          writeLocalGuideState()
          blackboardEditMode.value = 'live'
          load()
        }

        await loadExportBlackboardSet(exportBlackboardSetId.value)
        return true
      }
      catch (error) {
        console.warn('[blackboard] Failed to delete blackboard set', error)
        return false
      }
    }

    async function saveCurrentBlackboardsToSet(
      kind: Exclude<BlackboardBoardSetKind, 'current-live'>,
      target: { id?: string, name?: string } = {},
    ) {
      if (kind === 'guide' && !canSaveGuides.value)
        return undefined
      if (kind !== 'guide' && !canSavePrefilledLiveBoards.value)
        return undefined

      save()
      const state = editMode.value === 'guide'
        ? persistedGuideState()
        : persistedLiveState()

      try {
        const response = await saveBoardSet(boardSetsEndpoint, kind, target, state)
        exportBlackboardSets.value = response.sets || exportBlackboardSets.value
        if (kind === 'guide' && response.id) {
          activeGuideSetId.value = response.id
          const savedBoards = cloneBoards(response.state?.boards)
          if (savedBoards.length) {
            const aligned = alignBoardPairs(boards.value, savedBoards)
            commitGuideBoards(aligned.guideBoards, response.state?.activeBoardId, { load: editMode.value === 'guide', persist: false })
            commitLiveBoards(aligned.liveBoards, activeBoardId.value, { persist: false, sync: true })
          }
        }
        return response.set
      }
      catch (error) {
        console.warn('[blackboard] Failed to save blackboard set', error)
        return undefined
      }
    }

    async function createGuideSet(target: { name: string }) {
      if (!canSaveGuides.value)
        return undefined

      save()

      const guide = createBoard(1)
      const currentLiveBoardId = activeLiveBoard.value?.id
      const nextLiveBoards = liveBoardsWithCurrentDrawing().map(board => (
        board.id === currentLiveBoardId
          ? { ...board, guideBoardId: guide.id }
          : board
      ))

      try {
        const response = await saveBoardSet(boardSetsEndpoint, 'guide', { name: target.name }, {
          activeBoardId: guide.id,
          boards: [guide],
        })
        exportBlackboardSets.value = response.sets || exportBlackboardSets.value
        if (!response.id)
          return undefined

        activeGuideSetId.value = response.id
        const savedBoards = cloneBoards(response.state?.boards)
        const nextGuides = savedBoards.length ? savedBoards : [guide]
        const activeId = response.state?.activeBoardId || nextGuides[0]?.id || guide.id
        const linkedLiveBoards = nextLiveBoards.map(board => (
          board.id === currentLiveBoardId && activeId
            ? { ...board, guideBoardId: activeId }
            : board
        ))

        commitGuideBoards(nextGuides, activeId, { load: false, persist: false })
        commitLiveBoards(linkedLiveBoards, activeBoardId.value, { persist: false, sync: true })
        blackboardEditMode.value = 'guide'
        load()
        await loadExportBlackboardSets()
        return response.set
      }
      catch (error) {
        console.warn('[blackboard] Failed to create guide set', error)
        return undefined
      }
    }

    async function savePrefilledLiveBoards(target: { id?: string, name?: string } = {}) {
      return await saveCurrentBlackboardsToSet('prefilled-live', target)
    }

    async function saveNamedLiveBoards(name: string) {
      return await saveCurrentBlackboardsToSet('saved-live', { name })
    }

    async function saveGuides(target: { id?: string, name?: string } = {}) {
      return await saveCurrentBlackboardsToSet('guide', target)
    }

    async function loadBlackboardSetIntoMode(key: string, mode = editMode.value) {
      if (mode === 'guide' && !canEditGuides.value)
        throw new Error('Guide sets are only available in presenter mode')

      const setName = exportBlackboardSets.value.find(set => set.key === key)?.name
      save()
      const state = await loadBlackboardSet(key, true)
      const nextBoards = cloneBoards(state.boards)
      if (!nextBoards.length)
        throw new Error('The selected blackboard set is empty')

      const parsed = parseBoardSetKey(key)
      if (mode === 'guide') {
        const aligned = alignBoardPairs(boards.value, nextBoards)
        if (parsed?.kind === 'guide')
          activeGuideSetId.value = parsed.id
        commitGuideBoards(aligned.guideBoards, state.activeBoardId, { load: editMode.value === 'guide', persist: true })
        commitLiveBoards(aligned.liveBoards, activeBoardId.value, { persist: true, sync: true })
      }
      else {
        const aligned = guidesEnabled
          ? alignBoardPairs(nextBoards, guideBoards.value)
          : { liveBoards: nextBoards, guideBoards: guideBoards.value }
        if (state.theme)
          boardTheme.value = normalizeBoardTheme(state.theme)
        if (guidesEnabled)
          commitGuideBoards(aligned.guideBoards, activeGuideBoardId.value, { load: editMode.value === 'guide', persist: true })
        commitLiveBoards(aligned.liveBoards, state.activeBoardId, { load: editMode.value === 'live', persist: true, sync: true })
      }

      blackboardEditMode.value = mode === 'guide' && canEditGuides.value ? 'guide' : 'live'
      load()
      exportBlackboardSetId.value = 'current'
      exportBlackboardSetBoards.value = []
      await loadExportBlackboardSets()
      return setName || exportBlackboardSets.value.find(set => set.key === key)?.name || 'blackboard set'
    }

    async function loadBlackboardSetIntoCurrentMode(key: string) {
      try {
        const parsed = parseBoardSetKey(key)
        const mode = parsed?.kind === 'guide' ? 'guide' : 'live'
        return await loadBlackboardSetIntoMode(key, mode)
      }
      catch (error) {
        console.warn('[blackboard] Failed to load blackboard set', error)
        return undefined
      }
    }

    async function resetLiveFromPrefilled(key?: string) {
      if (!canSavePrefilledLiveBoards.value)
        return

      save()
      try {
        const parsed = key ? parseBoardSetKey(key) : undefined
        if (key && parsed?.kind !== 'prefilled-live')
          throw new Error('Reset requires a pre-made live set')

        const restored = await resetLiveBoardSet(resetLiveEndpoint, key || (parsed?.id ? `prefilled-live:${parsed.id}` : undefined))
        const nextLiveBoards = cloneBoards(restored.boards)
        const aligned = guidesEnabled
          ? alignBoardPairs(nextLiveBoards, guideBoards.value)
          : { liveBoards: nextLiveBoards, guideBoards: guideBoards.value }

        if (restored.theme)
          boardTheme.value = normalizeBoardTheme(restored.theme)
        if (guidesEnabled)
          commitGuideBoards(aligned.guideBoards, activeGuideBoardId.value, { load: editMode.value === 'guide', persist: true })
        commitLiveBoards(aligned.liveBoards, restored.activeBoardId, { load: editMode.value === 'live', persist: true, sync: true })
        exportBlackboardSetId.value = 'current'
        exportBlackboardSetBoards.value = []
        await loadExportBlackboardSets()
        return true
      }
      catch (error) {
        console.warn('[blackboard] Failed to reset live blackboards', error)
        return false
      }
    }

    function newBoard() {
      insertBoardAt(boardCount.value)
    }

    function insertBoardAt(index: number) {
      const mode = editMode.value
      const liveBoards = mode === 'live' ? liveBoardsWithCurrentDrawing() : boards.value
      const guides = mode === 'guide' ? guideBoardsWithCurrentDrawing() : guideBoards.value
      const insertIndex = Math.max(0, Math.min(index, Math.max(liveBoards.length, guides.length)))
      const guide = createBoard(insertIndex + 1)
      const liveBoard = createBoard(insertIndex + 1, '', guidesEnabled ? guide.id : undefined)
      const nextLiveBoards = [
        ...liveBoards.slice(0, insertIndex),
        liveBoard,
        ...liveBoards.slice(insertIndex),
      ]
      const nextGuideBoards = guidesEnabled
        ? [
            ...guides.slice(0, insertIndex),
            guide,
            ...guides.slice(insertIndex),
          ]
        : guides

      if (guidesEnabled)
        commitGuideBoards(nextGuideBoards, guide.id, { load: mode === 'guide', persist: true })
      commitLiveBoards(nextLiveBoards, liveBoard.id, { load: mode === 'live', persist: true, sync: true })
    }

  function insertBoardBefore() {
    insertBoardAt(activeBoardIndex.value)
  }

  function insertBoardAfter() {
    insertBoardAt(activeBoardIndex.value + 1)
  }

    function removeBoard() {
      if (!canRemoveBoard.value)
        return

      const mode = editMode.value
      const liveBoard = removalLiveBoard.value
      const guideBoard = removalGuideBoard.value
      const liveIndex = liveBoard ? boards.value.findIndex(board => board.id === liveBoard.id) : -1
      const guideIndex = guideBoard ? guideBoards.value.findIndex(board => board.id === guideBoard.id) : -1

      if (liveIndex < 0 && guideIndex < 0)
        return

      const liveFocusIndex = liveIndex > 0 ? liveIndex - 1 : 0
      const guideFocusIndex = guideIndex > 0 ? guideIndex - 1 : 0

      let nextGuideBoards = guideIndex >= 0
        ? guideBoards.value.filter(board => board.id !== guideBoard?.id)
        : guideBoardsWithCurrentDrawing()
      let nextActiveGuideBoardId = activeGuideBoardId.value

      if (guidesEnabled) {
        nextActiveGuideBoardId = nextGuideBoards[Math.min(guideFocusIndex, nextGuideBoards.length - 1)]?.id
          || nextGuideBoards[0]?.id
          || ''
      }

      let nextLiveBoards = liveIndex >= 0
        ? liveBoardsWithCurrentDrawing()
            .filter(board => board.id !== liveBoard?.id)
            .map(board => board.guideBoardId === guideBoard?.id ? { ...board, guideBoardId: undefined } : board)
        : liveBoardsWithCurrentDrawing()
      let nextActiveLiveBoardId = activeBoardId.value

      nextActiveLiveBoardId = nextLiveBoards[Math.min(liveFocusIndex, nextLiveBoards.length - 1)]?.id
        || nextLiveBoards[0]?.id
        || ''

      if (guidesEnabled && (guideIndex >= 0 || guideBoards.value.length))
        commitGuideBoards(nextGuideBoards, nextActiveGuideBoardId, { load: mode === 'guide', persist: true })
      if (liveIndex >= 0 || boards.value.length)
        commitLiveBoards(nextLiveBoards, nextActiveLiveBoardId, { load: mode === 'live', persist: true, sync: true })
    }

    function selectBoard(id: string) {
      const mode = editMode.value
      if (id === activeBoard.value?.id || !boardsForMode(mode).some(board => board.id === id))
        return

      commitBoardsForMode(mode, boardsWithCurrentDrawing(mode), id, { load: true, persist: true, sync: mode === 'live' })
    }

    function previousBoard() {
      const board = boardsForMode(editMode.value)[activeBoardIndex.value - 1]
      if (board)
        selectBoard(board.id)
    }

    function nextBoard() {
      const board = boardsForMode(editMode.value)[activeBoardIndex.value + 1]
      if (board)
        selectBoard(board.id)
    }

  function applyDrawingMode(mode: BlackboardToolMode) {
    if (mode === 'arrow') {
      drauu.mode = 'line'
      brush.arrowEnd = true
    }
    else {
      drauu.mode = mode
      brush.arrowEnd = false
    }
    refreshEraserFragments(drauu, mode)
  }

  function setMode(mode: BlackboardToolMode) {
    drawingMode.value = mode
    applyDrawingMode(mode)
    if (mode !== 'eraseLine')
      lastDrawingMode = mode
  }

  function resumeDrawingMode() {
    setMode(lastDrawingMode)
  }

  function setBrushColor(color: string) {
    brush.color = normalizePrimaryColor(color)
    resumeDrawingMode()
  }

  async function loadExhibitPayload(exhibit: BlackboardExhibit) {
    return await loadExhibitPayloadFromApi(exhibitEndpoint, exhibit)
  }

  async function beginExhibitPlacement(exhibit: BlackboardExhibit) {
    if (!canShowExhibits.value)
      return

    try {
      pendingExhibit.value = await loadExhibitPayload(exhibit)
      exhibitPickerVisible.value = false
    }
    catch (error) {
      console.warn('[blackboard] Failed to load exhibit', error)
      alertAction('Failed to load this exhibit.')
    }
  }

  function cancelExhibitPlacement() {
    pendingExhibit.value = undefined
  }

  function eraseExhibitsBetweenPoints(start: BlackboardPoint, end: BlackboardPoint) {
    if (!drauu.mounted || drawingMode.value !== 'eraseLine' || !drauu.el)
      return false

    const padding = Math.max(1.5, Number(brush.size || 1) * 0.45)
    const { erased, erasedLockedExhibits } = eraserIntersectingExhibits(drauu.el, start, end, padding)

    if (!erasedLockedExhibits.length && !erased.length)
      return false

    erasedLockedExhibits.forEach(element => element.remove())
    erased.forEach(element => element.remove())
    reindexDrauuElements(drauu)
    refreshEraserFragments(drauu, drawingMode.value)
    save()
    return true
  }

  function insertExhibit(payload: BlackboardRenderedExhibit, rect: BlackboardPlacementRect) {
    if (!activeBoard.value || payload.width <= 0 || payload.height <= 0)
      return

    const placementWidth = Math.abs(rect.width)
    const placementHeight = Math.abs(rect.height)
    if (placementWidth < 8 || placementHeight < 8)
      return

    const scale = Math.max(0.02, Math.min(placementWidth / payload.width, placementHeight / payload.height))
    const renderedWidth = payload.width * scale
    const renderedHeight = payload.height * scale
    const x = rect.x + ((placementWidth - renderedWidth) / 2)
    const y = rect.y + ((placementHeight - renderedHeight) / 2)
    const roundedX = roundBoardNumber(x)
    const roundedY = roundBoardNumber(y)
    const roundedScale = roundBoardNumber(scale, 4)
    const exhibitSvg = placedExhibitSvg(payload.svg, roundedX, roundedY, roundedScale, payload)
    if (!exhibitSvg) {
      alertAction('Failed to place this exhibit.')
      pendingExhibit.value = undefined
      setMode('stylus')
      return
    }

      const mode = editMode.value
      const currentBoards = boardsWithCurrentDrawing(mode)
      const activeId = activeBoard.value.id
      const now = Date.now()
    const nextBoards = currentBoards.map(board => board.id === activeId
      ? {
          ...board,
          drawing: `${board.drawing || ''}${board.drawing?.trim() ? '\n' : ''}${exhibitSvg}`,
          updatedAt: now,
        }
      : board)

      pendingExhibit.value = undefined
      commitBoardsForMode(mode, nextBoards, activeId, { load: true, persist: true, sync: mode === 'live' })
      setMode('stylus')
    }

  function setBoardTheme(theme: BlackboardBoardTheme) {
    const next = normalizeBoardTheme(theme)
    if (boardTheme.value === next)
      return

      boardTheme.value = next
      persistLiveBoardState()
      syncBoardState()
    }

  function toggleBoardTheme() {
    setBoardTheme(nextBoardTheme.value)
  }

  function setOpen(open: boolean) {
    if (!blackboardsEnabled)
      return

    isOpen.value = open
    syncOpenState(open)
  }

  function open() {
    setOpen(true)
  }

  function close() {
    setOpen(false)
  }

  function toggle() {
    setOpen(!isSyncedOpen.value)
  }

  function shouldSendSyncCommand() {
    if (!blackboardsEnabled)
      return false

    return canSendSyncCommand(isNotesViewer.value, isPrintMode.value)
  }

  function shouldReceiveSyncCommand() {
    if (!blackboardsEnabled)
      return false

    return canReceiveSyncCommand(isPrintMode.value)
  }

  function syncOpenState(open: boolean) {
    if (!shouldSendSyncCommand())
      return

    const id = createSyncId(clientId, 'open')

    lastSentOpenId = id
      const patch: BlackboardSyncState = {
        activeBoardId: activeBoardId.value,
        boardTheme: boardTheme.value,
        boards: cloneBoards(liveBoardsWithCurrentDrawing()),
      openId: id,
      openClientId: clientId,
      open,
      openSource: syncType.value,
      openTime: Date.now(),
    }

      if (open) {
        const stateId = createSyncId(clientId, 'state')
        lastSentStateId = stateId
        patch.activeDrawing = editMode.value === 'live' && drauu.mounted ? currentDrauuDrawing(drauu) : activeLiveBoard.value?.drawing || ''
      patch.stateId = stateId
      patch.stateSource = syncType.value
      patch.stateTime = Date.now()
    }

    patchServerBlackboard(patch)
    scheduleOpenSyncCleanup(!open)
  }

  function scheduleOpenSyncCleanup(clearOwner: boolean) {
    if (openSyncCleanupTimer)
      clearTimeout(openSyncCleanupTimer)

    openSyncCleanupTimer = setTimeout(() => {
      patchServerBlackboard({
        open: undefined,
        openId: undefined,
        ...(clearOwner ? { openClientId: undefined } : {}),
        openSource: undefined,
        openTime: undefined,
      })
      openSyncCleanupTimer = undefined
    }, 1500)
  }

  function applySyncedBoardTheme(state: BlackboardSyncState) {
    if (!state.boardTheme)
      return

    const next = normalizeBoardTheme(state.boardTheme)
    if (next !== boardTheme.value)
      boardTheme.value = next
  }

  function applySyncedBoards(state: BlackboardSyncState) {
    applySyncedBoardTheme(state)

      if (!state.boards?.length)
        return

      commitLiveBoards(state.boards, state.activeBoardId, { load: true })
    }

  function isFreshOpenSyncCommand(state: BlackboardSyncState) {
    return isFreshOpenSyncCommandFromState(state, lastSentOpenId, lastAppliedOpenId, clientStartedAt)
  }

  function isFreshBoardSyncCommand(state: BlackboardSyncState) {
    return isFreshBoardSyncCommandFromState(state, lastSentStateId, lastAppliedStateId, clientStartedAt)
  }

  function applySyncState(state: BlackboardSyncState | undefined) {
    if (!state || !shouldReceiveSyncCommand())
      return

    if (isFreshOpenSyncCommand(state)) {
      lastAppliedOpenId = state.openId
      isOpen.value = state.open
    }

    if (isFreshBoardSyncCommand(state)) {
      lastAppliedStateId = state.stateId
      applySyncedBoards(state)
    }
  }

  function reconcileSyncState(state: BlackboardSyncState | undefined) {
    if (!state || !shouldReceiveSyncCommand())
      return

    if (isFreshOpenSyncCommand(state)) {
      lastAppliedOpenId = state.openId
      isOpen.value = state.open
    }

    applySyncedBoardTheme(state)

    if (isFreshBoardSyncCommand(state)) {
      lastAppliedStateId = state.stateId
      applySyncedBoards(state)
    }
  }

  drauu.on('changed', save)
  drauu.on('start', () => isDrawing.value = true)
  drauu.on('end', () => isDrawing.value = false)

  watch(drawingMode, applyDrawingMode, { immediate: true })

  watch(isOpen, (open) => {
    if (open && !releaseShortcutLock)
      releaseShortcutLock = lockShortcuts()
    else if (!open && releaseShortcutLock) {
      releaseShortcutLock()
      releaseShortcutLock = undefined
    }
  }, { immediate: true })

    watch(guideOpacity, (value) => {
      if (!Number.isFinite(value))
        return

    const clamped = Math.min(1, Math.max(0, value))
      if (clamped !== value)
        guideOpacity.value = clamped
    })

    watch(editMode, () => {
      pendingExhibit.value = undefined
      load()
    }, { flush: 'post' })

    watch(() => serverState.value, applySyncState, { deep: true, immediate: true })

  watch([currentSlideNo, isPresenter], () => {
    reconcileSyncState(serverState.value)
  }, { flush: 'post' })

    if (!boards.value.some(board => board.id === activeBoardId.value))
      activeBoardId.value = boards.value[0]?.id || ''
    writeLocalBoardState()
    if (guidesEnabled && !guideBoards.value.some(board => board.id === activeGuideBoardId.value))
      activeGuideBoardId.value = guideBoards.value[0]?.id || ''
    writeLocalGuideState()

  function shouldIgnoreBlackboardShortcut(event: KeyboardEvent) {
    const target = event.target
    if (!(target instanceof Element))
      return false

    return !!target.closest('input, textarea, select, [contenteditable], .slidev-blackboard-set-dialog')
  }

  function handleBlackboardShortcut(event: KeyboardEvent) {
    if (!isOpen.value || !canEdit.value)
      return
    if (shouldIgnoreBlackboardShortcut(event))
      return

    if (event.code === 'Escape') {
      if (pendingExhibit.value)
        cancelExhibitPlacement()
      else
        close()
    }
    else if (event.code === 'KeyZ' && (event.metaKey || event.ctrlKey)) {
      if (event.shiftKey)
        redo()
      else
        undo()
    }
    else if (!event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey && event.code === 'KeyS') {
      setMode('stylus')
    }
    else if (!event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey && event.code === 'KeyL') {
      setMode('line')
    }
    else if (!event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey && event.code === 'KeyA') {
      setMode('arrow')
    }
    else if (!event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey && event.code === 'KeyR') {
      setMode('rectangle')
    }
    else if (!event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey && event.code === 'KeyE') {
      setMode('ellipse')
    }
    else if (!event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey && event.code === 'KeyC') {
      clear()
    }
    else if (!event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey && event.code.startsWith('Digit')) {
      const index = +event.code[5] - 1
      if (index < 0 || index >= brushColors.length)
        return

      setBrushColor(brushColors[index])
    }
    else {
      return
    }

    event.preventDefault()
    event.stopPropagation()
  }

  function dispose() {
    if (openSyncCleanupTimer)
      clearTimeout(openSyncCleanupTimer)
    if (persistTimer)
      clearTimeout(persistTimer)
    if (guidePersistTimer)
      clearTimeout(guidePersistTimer)
    openSyncCleanupTimer = undefined
    persistTimer = undefined
    guidePersistTimer = undefined

    if (releaseShortcutLock) {
      releaseShortcutLock()
      releaseShortcutLock = undefined
    }

    if (typeof window !== 'undefined' && keydownHandler) {
      window.removeEventListener('keydown', keydownHandler, false)
      keydownHandler = undefined
    }
  }

  if (typeof window !== 'undefined') {
    if (blackboardsEnabled)
      void loadExportBlackboardSets()

    keydownHandler = handleBlackboardShortcut
    window.addEventListener('keydown', keydownHandler, false)
  }

  import.meta.hot?.dispose(dispose)

    return {
      activeBoard,
      activeBoardId,
      activeBoardIndex,
      activeGuideBoard,
      activeGuideBoardId,
      activeGuideSetName,
      activeLiveBoard,
      boardCount,
      boardTheme,
      boardThemeClass,
      buildAppendixBlackboardThemeClass,
      buildAppendixBoards,
      blackboardsEnabled,
      blackboardEditMode: editMode,
      boards,
      brush,
      brushColors,
      canClear,
      canEdit,
      canEditGuides,
      canExportBlackboards,
      canGoNextBoard,
      canGoPreviousBoard,
      canRemoveBoard,
      canRedo,
      canSaveGuides,
      canSavePrefilledLiveBoards,
      canShowExhibits,
      canUndo,
    cancelExhibitPlacement,
    canvasHeight,
    canvasWidth,
    clear,
    close,
    drauu,
    eraseExhibitsBetweenPoints,
      displayBrushColor,
      deleteBlackboardSet,
      drawingData,
    drawingMode,
    beginExhibitPlacement,
    exportBlackboardSetId,
    exportBlackboardSets,
    exportBlackboardTheme,
    exportBlackboardThemeClass,
    exportableBoards,
    exportBlackboards,
      exhibitPickerVisible,
      exhibits,
      guideBoards,
      guideOpacity,
      hasGuideBoards,
      isDrawing,
      isAutomatedPrintExport,
      isOpen,
      isSyncedOpen,
    insertBoardAfter,
    insertBoardBefore,
      insertExhibit,
      load,
      loadBlackboardSetIntoCurrentMode,
      loadExportBlackboardSets,
      loadExhibitPayload,
      newBoard,
      nextBoard,
      open,
    persistedBoardsEnabled,
    pendingExhibit,
    printExportBlackboards,
    printExportBlackboardTheme,
    printExportBlackboardThemeClass,
      previousBoard,
      referenceBoard,
      referenceControlsVisible,
      referenceLayerVisible,
      redo,
      removeBoard,
      resumeDrawingMode,
      resetLiveFromPrefilled,
      createGuideSet,
      saveCurrentBlackboardsToSet,
      saveGuides,
      saveNamedLiveBoards,
      savePrefilledLiveBoards,
      selectBoard,
      setExportBlackboardSet,
      setExportBlackboardTheme,
      setBlackboardEditMode,
      setBrushColor,
    setMode,
    toolbarVisible,
    toggle,
    toggleBoardTheme,
    undo,
  }
}

export function useBlackboard() {
  blackboardState ??= createBlackboard()
  return blackboardState
}
