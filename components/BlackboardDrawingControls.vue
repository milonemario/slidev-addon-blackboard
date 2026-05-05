<script setup lang="ts">
import IconButton from '@slidev/client/internals/IconButton.vue'
import VerticalDivider from '@slidev/client/internals/VerticalDivider.vue'
import { computed, onMounted, ref } from 'vue'
import { useBlackboard } from '../composables/useBlackboard'
import BlackboardSetDialog from './BlackboardSetDialog.vue'

type ToolbarToolMode = 'stylus' | 'line' | 'arrow' | 'ellipse' | 'rectangle' | 'eraseLine'
type BlackboardSetDialogMode = 'save' | 'load' | 'reset' | 'create-guide'
type BlackboardSetDialogHandle = {
  open: (mode: BlackboardSetDialogMode) => Promise<void>
}
type ToolbarPosition = {
  x: number
  y: number
}
type ToolbarDragState = {
  pointerId: number
  startX: number
  startY: number
  originX: number
  originY: number
}

const toolbarStorageKey = 'slidev-blackboard-toolbar-pos'

const {
  brush,
  brushColors,
  activeBoardIndex,
  activeBoardLoading,
  activeGuideSetName,
  blackboardEditMode,
  boardCount,
  boardTheme,
  canClear,
  canEditGuides,
  canGoNextBoard,
  canGoPreviousBoard,
  canRemoveBoard,
  canRedo,
  canSaveGuides,
  canSavePrefilledLiveBoards,
  canShowExhibits,
  canUndo,
  clear,
  displayBrushColor,
  drawingMode,
  exhibitPickerVisible,
  guideOpacity,
  hasGuideBoards,
  insertBoardAfter,
  insertBoardBefore,
  nextBoard,
  previousBoard,
  redo,
  referenceControlsVisible,
  removeBoard,
  resumeDrawingMode,
  setBlackboardEditMode,
  setBrushColor,
  setMode,
  toolbarVisible,
  toggleBoardTheme,
  undo,
} = useBlackboard()

const emit = defineEmits<{
  close: []
}>()

const toolMenuOpen = ref(false)
const colorMenuOpen = ref(false)
const opacityMenuOpen = ref(false)
const setDialog = ref<BlackboardSetDialogHandle>()
const toolbarWrap = ref<HTMLElement>()
const toolbarPosition = ref<ToolbarPosition>({ x: 10, y: 10 })
const toolbarDragState = ref<ToolbarDragState>()

const drawingTools: Array<{
  mode: ToolbarToolMode
  title: string
  icon?: string
  line?: boolean
}> = [
  { mode: 'stylus', title: 'Draw with stylus', icon: 'i-carbon:pen' },
  { mode: 'line', title: 'Draw a line', line: true },
  { mode: 'arrow', title: 'Draw an arrow', icon: 'i-carbon:arrow-up-right' },
  { mode: 'ellipse', title: 'Draw an ellipse', icon: 'i-carbon:radio-button' },
  { mode: 'rectangle', title: 'Draw a rectangle', icon: 'i-carbon:checkbox' },
  { mode: 'eraseLine', title: 'Erase', icon: 'i-carbon:erase' },
]

const activeTool = computed(() => (
  drawingTools.find(tool => tool.mode === drawingMode.value) || drawingTools[0]
))

const canSaveCurrentBoards = computed(() => (
  blackboardEditMode.value === 'guide'
    ? canSaveGuides.value
    : canSaveGuides.value || canSavePrefilledLiveBoards.value
))

const saveButtonTitle = computed(() => (
  blackboardEditMode.value === 'guide'
    ? 'Save blackboard guides'
    : 'Save blackboard set'
))

const removeButtonTitle = computed(() => (
  canEditGuides.value
    ? 'Remove current live blackboard and matching guide blackboard'
    : 'Remove current blackboard'
))

const removeConfirmationMessage = computed(() => (
  canEditGuides.value
    ? 'Remove this live blackboard and its matching guide blackboard? This cannot be undone.'
    : 'Remove this blackboard? This cannot be undone.'
))

const clearButtonTitle = computed(() => (
  blackboardEditMode.value === 'guide'
    ? 'Clear current guide blackboard'
    : 'Clear current live blackboard'
))

const activeBrushColor = computed(() => displayBrushColor(brush.color))
const opacityLabel = computed(() => `${Math.round(guideOpacity.value * 100)}%`)
const toolbarStyle = computed(() => ({
  left: `${toolbarPosition.value.x}px`,
  top: `${toolbarPosition.value.y}px`,
}))

function safeToolbarPosition(value: unknown): ToolbarPosition | undefined {
  if (!value || typeof value !== 'object')
    return

  const { x, y } = value as { x?: unknown, y?: unknown }
  if (typeof x !== 'number' || typeof y !== 'number')
    return

  return {
    x: Math.max(0, x),
    y: Math.max(0, y),
  }
}

function loadToolbarPosition() {
  if (typeof window === 'undefined')
    return

  try {
    const stored = safeToolbarPosition(JSON.parse(window.localStorage.getItem(toolbarStorageKey) || 'null'))
    if (stored)
      toolbarPosition.value = clampToolbarPosition(stored)
  }
  catch {
    toolbarPosition.value = { x: 10, y: 10 }
  }
}

function persistToolbarPosition() {
  if (typeof window === 'undefined')
    return

  try {
    window.localStorage.setItem(toolbarStorageKey, JSON.stringify(toolbarPosition.value))
  }
  catch {
    return
  }
}

function clampToolbarPosition(position: ToolbarPosition): ToolbarPosition {
  if (typeof window === 'undefined')
    return position

  const bounds = toolbarWrap.value?.getBoundingClientRect()
  const maxX = Math.max(0, window.innerWidth - (bounds?.width || 24))
  const maxY = Math.max(0, window.innerHeight - (bounds?.height || 24))

  return {
    x: Math.max(0, Math.min(position.x, maxX)),
    y: Math.max(0, Math.min(position.y, maxY)),
  }
}

function startToolbarDrag(event: PointerEvent) {
  if (event.button !== 0)
    return

  event.preventDefault()
  event.stopPropagation()
  toolbarDragState.value = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    originX: toolbarPosition.value.x,
    originY: toolbarPosition.value.y,
  }
  const target = event.currentTarget as HTMLElement
  target.setPointerCapture?.(event.pointerId)
}

function moveToolbar(event: PointerEvent) {
  const drag = toolbarDragState.value
  if (!drag || drag.pointerId !== event.pointerId)
    return

  event.preventDefault()
  event.stopPropagation()
  toolbarPosition.value = clampToolbarPosition({
    x: drag.originX + event.clientX - drag.startX,
    y: drag.originY + event.clientY - drag.startY,
  })
}

function stopToolbarDrag(event: PointerEvent) {
  const drag = toolbarDragState.value
  if (!drag || drag.pointerId !== event.pointerId)
    return

  event.preventDefault()
  event.stopPropagation()
  toolbarDragState.value = undefined
  const target = event.currentTarget as HTMLElement
  target.releasePointerCapture?.(event.pointerId)
  persistToolbarPosition()
}

function closeMenus() {
  toolMenuOpen.value = false
  colorMenuOpen.value = false
  opacityMenuOpen.value = false
}

function toggleToolMenu() {
  toolMenuOpen.value = !toolMenuOpen.value
  colorMenuOpen.value = false
  opacityMenuOpen.value = false
}

function selectTool(mode: ToolbarToolMode) {
  setMode(mode)
  toolMenuOpen.value = false
}

function toggleColorMenu() {
  colorMenuOpen.value = !colorMenuOpen.value
  toolMenuOpen.value = false
  opacityMenuOpen.value = false
}

function toggleOpacityMenu() {
  opacityMenuOpen.value = !opacityMenuOpen.value
  toolMenuOpen.value = false
  colorMenuOpen.value = false
}

function selectColor(color: string) {
  setBrushColor(color)
  colorMenuOpen.value = false
}

function clearCurrentBoard() {
  closeMenus()
  if (!canClear.value)
    return

  clear()
}

function removeCurrentBoard() {
  closeMenus()
  if (!canRemoveBoard.value)
    return

  if (typeof window !== 'undefined' && !window.confirm(removeConfirmationMessage.value))
    return

  removeBoard()
}

function openSetDialog(mode: BlackboardSetDialogMode) {
  closeMenus()
  void setDialog.value?.open(mode)
}

function saveCurrentBoards() {
  openSetDialog('save')
}

function resetCurrentLiveBoards() {
  openSetDialog('reset')
}

function loadBlackboardSet() {
  openSetDialog('load')
}

function editGuides() {
  closeMenus()
  if (hasGuideBoards.value)
    setBlackboardEditMode('guide')
  else
    void setDialog.value?.open('create-guide')
}

onMounted(() => {
  loadToolbarPosition()
})
</script>

<template>
  <div
    ref="toolbarWrap"
    class="slidev-blackboard__toolbar-wrap"
    :style="toolbarStyle"
  >
    <div
      class="slidev-blackboard__toolbar flex flex-wrap text-xl p-2 gap-1 rounded-md bg-main shadow transition-opacity duration-200 z-nav border border-main"
      :class="{ 'is-collapsed': !toolbarVisible }"
      @pointerdown.stop
    >
      <template v-if="toolbarVisible">
        <button
          type="button"
          class="slidev-blackboard__drag-handle"
          title="Move tools"
          aria-label="Move tools"
          @pointerdown="startToolbarDrag"
          @pointermove="moveToolbar"
          @pointerup="stopToolbarDrag"
          @pointercancel="stopToolbarDrag"
        >
          <div class="i-carbon:drag-vertical" />
        </button>

        <IconButton title="Insert blackboard before current" @click="insertBoardBefore">
          <div class="slidev-blackboard__insert-icon">
            <div class="i-carbon:add-alt" />
            <div class="i-carbon:previous-outline" />
          </div>
        </IconButton>

        <IconButton title="Previous blackboard" :class="{ disabled: !canGoPreviousBoard }" @click="previousBoard">
          <div class="i-carbon:previous-outline" />
        </IconButton>

        <span class="slidev-blackboard__board-status">
          <span v-if="activeBoardLoading" class="slidev-blackboard__board-loading-icon i-carbon:circle-dash" />
          <span>{{ activeBoardIndex + 1 }}/{{ boardCount }}</span>
        </span>

        <IconButton title="Next blackboard" :class="{ disabled: !canGoNextBoard }" @click="nextBoard">
          <div class="i-carbon:next-outline" />
        </IconButton>

        <IconButton title="Insert blackboard after current" @click="insertBoardAfter">
          <div class="slidev-blackboard__insert-icon">
            <div class="i-carbon:add-alt" />
            <div class="i-carbon:next-outline" />
          </div>
        </IconButton>

        <VerticalDivider />

        <IconButton :title="removeButtonTitle" :class="{ disabled: !canRemoveBoard }" @click="removeCurrentBoard">
          <div class="i-carbon:subtract-alt" />
        </IconButton>

        <IconButton
          v-if="canEditGuides"
          title="Edit live blackboards"
          :class="blackboardEditMode === 'live' ? 'active' : 'shallow'"
          @click="setBlackboardEditMode('live')"
        >
          <div class="i-carbon:screen" />
        </IconButton>

        <IconButton
          v-if="canEditGuides"
          :title="`Edit guides: ${activeGuideSetName}`"
          :class="['slidev-blackboard__guide-mode-button', blackboardEditMode === 'guide' ? 'active' : 'shallow']"
          @click="editGuides"
        >
          <div class="i-carbon:layers" />
          <span class="slidev-blackboard__guide-mode-label">{{ activeGuideSetName }}</span>
        </IconButton>

        <IconButton
          v-if="canSaveCurrentBoards"
          :title="saveButtonTitle"
          @click="saveCurrentBoards"
        >
          <div class="i-carbon:save" />
        </IconButton>

        <IconButton
          title="Load a blackboard set"
          @click="loadBlackboardSet"
        >
          <div class="i-carbon:folder-open" />
        </IconButton>

        <IconButton
          v-if="canSavePrefilledLiveBoards"
          title="Reset live blackboards from pre-made live blackboards"
          @click="resetCurrentLiveBoards"
        >
          <div class="i-carbon:reset" />
        </IconButton>

        <IconButton v-if="canShowExhibits" title="Exhibits" @click="exhibitPickerVisible = !exhibitPickerVisible">
          <div class="i-carbon:data-vis-4" />
        </IconButton>

        <VerticalDivider />

        <IconButton :title="boardTheme === 'whiteboard' ? 'Switch to blackboard' : 'Switch to whiteboard'" @click="toggleBoardTheme">
          <div class="i-carbon:contrast" />
        </IconButton>

        <div v-if="referenceControlsVisible" class="slidev-blackboard__menu-group">
          <IconButton
            :title="`Reference opacity: ${opacityLabel}`"
            class="slidev-blackboard__dropdown-button active"
            @click="toggleOpacityMenu"
          >
            <div class="i-carbon:opacity" />
            <div class="slidev-blackboard__dropdown-caret i-carbon:chevron-down" />
          </IconButton>

          <div v-if="opacityMenuOpen" class="slidev-blackboard__flyout slidev-blackboard__opacity-flyout">
            <label
              class="slidev-blackboard__range-control slidev-blackboard__opacity slidev-blackboard__opacity-slider bg-main"
              title="Adjust reference opacity"
              @pointerdown.stop
              @mousedown.stop
              @touchstart.stop
              @click.stop
            >
              <span class="sr-only">Adjust reference opacity</span>
              <input v-model.number="guideOpacity" type="range" min="0.05" max="0.7" step="0.05">
              <span class="slidev-blackboard__range-value slidev-blackboard__opacity-value">{{ opacityLabel }}</span>
            </label>
          </div>
        </div>

        <VerticalDivider v-if="referenceControlsVisible" />

        <div class="slidev-blackboard__menu-group">
          <IconButton
            :title="`Drawing tool: ${activeTool.title}`"
            class="slidev-blackboard__dropdown-button active"
            @click="toggleToolMenu"
          >
            <span v-if="activeTool.line" class="slidev-blackboard__line-tool-icon" />
            <div v-else :class="activeTool.icon" />
            <div class="slidev-blackboard__dropdown-caret i-carbon:chevron-down" />
          </IconButton>

          <div v-if="toolMenuOpen" class="slidev-blackboard__flyout slidev-blackboard__tool-flyout">
            <div class="slidev-blackboard__tool-grid">
              <IconButton
                v-for="tool of drawingTools"
                :key="tool.mode"
                :title="tool.title"
                :class="drawingMode === tool.mode ? 'active' : 'shallow'"
                @click="selectTool(tool.mode)"
              >
                <span v-if="tool.line" class="slidev-blackboard__line-tool-icon" />
                <div v-else :class="tool.icon" />
              </IconButton>
            </div>

            <label
              class="slidev-blackboard__range-control slidev-blackboard__size slidev-blackboard__tool-size bg-main"
              title="Adjust stroke width"
              @pointerdown.stop
              @mousedown.stop
              @touchstart.stop
              @click.stop
            >
              <span class="sr-only">Adjust stroke width</span>
              <span class="slidev-blackboard__range-value slidev-blackboard__size-value">{{ brush.size }}</span>
              <svg viewBox="0 0 32 32" width="1.2em" height="1.2em">
                <line x1="2" y1="15" x2="22" y2="4" stroke="currentColor" stroke-width="1" stroke-linecap="round" />
                <line x1="2" y1="24" x2="28" y2="10" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
                <line x1="7" y1="31" x2="29" y2="19" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
              </svg>
              <input v-model.number="brush.size" type="range" min="1" max="15" @change="resumeDrawingMode()">
            </label>
          </div>
        </div>

        <VerticalDivider />

        <div class="slidev-blackboard__menu-group">
          <IconButton
            title="Change brush color"
            class="slidev-blackboard__dropdown-button slidev-blackboard__color-button active"
            @click="toggleColorMenu"
          >
            <span
              class="slidev-blackboard__swatch"
              :style="{ background: activeBrushColor }"
            />
            <div class="slidev-blackboard__dropdown-caret i-carbon:chevron-down" />
          </IconButton>

          <div v-if="colorMenuOpen" class="slidev-blackboard__flyout slidev-blackboard__color-flyout">
            <IconButton
              v-for="color of brushColors"
              :key="color"
              title="Set brush color"
              :class="brush.color === color ? 'active' : 'shallow'"
              @click="selectColor(color)"
            >
              <div
                class="slidev-blackboard__swatch"
                :class="brush.color !== color ? 'is-inactive' : 'is-active'"
                :style="{ background: displayBrushColor(color) }"
              />
            </IconButton>
          </div>
        </div>

        <VerticalDivider />

        <IconButton title="Undo" :class="{ disabled: !canUndo }" @click="undo">
          <div class="i-carbon:undo" />
        </IconButton>

        <IconButton title="Redo" :class="{ disabled: !canRedo }" @click="redo">
          <div class="i-carbon:redo" />
        </IconButton>

        <IconButton :title="clearButtonTitle" :class="{ disabled: !canClear }" @click="clearCurrentBoard">
          <div class="i-carbon:clean" />
        </IconButton>

        <VerticalDivider />

        <IconButton title="Hide tools" @click="toolbarVisible = false">
          <div class="i-carbon:view-off" />
        </IconButton>

        <IconButton title="Close blackboard" @click="emit('close')">
          <div class="i-carbon:close" />
        </IconButton>
      </template>

      <template v-else>
        <button
          type="button"
          class="slidev-blackboard__drag-handle"
          title="Move tools"
          aria-label="Move tools"
          @pointerdown="startToolbarDrag"
          @pointermove="moveToolbar"
          @pointerup="stopToolbarDrag"
          @pointercancel="stopToolbarDrag"
        >
          <div class="i-carbon:drag-vertical" />
        </button>

        <IconButton title="Show tools" @click="toolbarVisible = true">
          <div class="i-carbon:view" />
        </IconButton>

        <IconButton title="Close blackboard" @click="emit('close')">
          <div class="i-carbon:close" />
        </IconButton>
      </template>
    </div>
  </div>

  <BlackboardSetDialog ref="setDialog" />
</template>
