<script setup lang="ts">
import { useNav } from '@slidev/client'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import BlackboardDrawingControls from './components/BlackboardDrawingControls.vue'
import BlackboardExhibitPicker from './components/BlackboardExhibitPicker.vue'
import { useBlackboard, type BlackboardPlacementRect, type BlackboardPoint } from './composables/useBlackboard'

const {
  blackboardsEnabled,
  boardThemeClass,
  canEdit,
  cancelExhibitPlacement,
  close,
  canvasHeight,
  canvasWidth,
  drauu,
  drawingMode,
  eraseExhibitsBetweenPoints,
  guideOpacity,
  insertExhibit,
  isOpen,
  load,
  nextBoard,
  pendingExhibit,
  previousBoard,
  referenceBoard,
  referenceLayerVisible,
} = useBlackboard()
const { nextSlide, prevSlide } = useNav()

const board = ref<HTMLElement>()
const svg = ref<SVGSVGElement>()
const placementStart = ref<{ x: number, y: number }>()
const placementRect = ref<BlackboardPlacementRect>()
const erasePoint = ref<BlackboardPoint>()
const touchSwipeStart = ref<{ pointerId: number, x: number, y: number }>()
const gridSize = 56
const boardStyle = computed(() => {
  const width = canvasWidth.value || 1400
  const height = canvasHeight.value || 1000
  const aspectRatio = width / height
  return {
    '--slidev-blackboard-aspect-ratio': `${aspectRatio}`,
    '--slidev-blackboard-fit-width': `${aspectRatio * 100}vh`,
    '--slidev-blackboard-grid-width': `${(gridSize / width) * 100}%`,
    '--slidev-blackboard-grid-height': `${(gridSize / height) * 100}%`,
  }
})
const placementPreviewTransform = computed(() => {
  const exhibit = pendingExhibit.value
  const rect = placementRect.value
  if (!exhibit || !rect || exhibit.width <= 0 || exhibit.height <= 0)
    return ''

  const scale = Math.max(0.02, Math.min(rect.width / exhibit.width, rect.height / exhibit.height))
  const renderedWidth = exhibit.width * scale
  const renderedHeight = exhibit.height * scale
  const x = rect.x + ((rect.width - renderedWidth) / 2)
  const y = rect.y + ((rect.height - renderedHeight) / 2)
  return `translate(${Math.round(x * 100) / 100} ${Math.round(y * 100) / 100}) scale(${Math.round(scale * 10000) / 10000})`
})

function boardPoint(event: PointerEvent) {
  const bounds = board.value?.getBoundingClientRect()
  if (!bounds)
    return { x: 0, y: 0 }

  return {
    x: Math.min(canvasWidth.value, Math.max(0, ((event.clientX - bounds.left) / bounds.width) * canvasWidth.value)),
    y: Math.min(canvasHeight.value, Math.max(0, ((event.clientY - bounds.top) / bounds.height) * canvasHeight.value)),
  }
}

function normalizePlacementRect(start: { x: number, y: number }, end: { x: number, y: number }): BlackboardPlacementRect {
  const x = Math.min(start.x, end.x)
  const y = Math.min(start.y, end.y)
  return {
    x,
    y,
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  }
}

function isBlackboardEditPointer(event: PointerEvent) {
  return event.pointerType === 'mouse' || event.pointerType === 'pen'
}

function beginTouchSwipe(event: PointerEvent) {
  if (event.pointerType !== 'touch')
    return

  touchSwipeStart.value = {
    pointerId: event.pointerId,
    x: event.clientX,
    y: event.clientY,
  }
  const target = event.currentTarget as HTMLElement
  target.setPointerCapture?.(event.pointerId)
}

function finishTouchSwipe(event: PointerEvent) {
  if (event.pointerType !== 'touch' || !touchSwipeStart.value || touchSwipeStart.value.pointerId !== event.pointerId)
    return

  const start = touchSwipeStart.value
  touchSwipeStart.value = undefined
  const distanceX = event.clientX - start.x
  const distanceY = event.clientY - start.y
  const x = Math.abs(distanceX)
  const y = Math.abs(distanceY)

  if (x / window.innerWidth > 0.3 || x > 75) {
    if (distanceX < 0)
      nextBoard()
    else
      previousBoard()
  }
  else if (y / window.innerHeight > 0.4 || y > 200) {
    if (distanceY > 0)
      prevSlide()
    else
      nextSlide()
  }
}

function cancelTouchSwipe(event: PointerEvent) {
  if (event.pointerType === 'touch' && touchSwipeStart.value?.pointerId === event.pointerId)
    touchSwipeStart.value = undefined
}

function beginPlacementDrag(event: PointerEvent) {
  if (!pendingExhibit.value || !isBlackboardEditPointer(event))
    return

  event.preventDefault()
  event.stopPropagation()
  const start = boardPoint(event)
  placementStart.value = start
  placementRect.value = { ...start, width: 0, height: 0 }
  const target = event.currentTarget as HTMLElement
  target.setPointerCapture?.(event.pointerId)
}

function updatePlacementDrag(event: PointerEvent) {
  if (!pendingExhibit.value || !placementStart.value || !isBlackboardEditPointer(event))
    return

  event.preventDefault()
  event.stopPropagation()
  placementRect.value = normalizePlacementRect(placementStart.value, boardPoint(event))
}

function finishPlacementDrag(event: PointerEvent) {
  if (!pendingExhibit.value || !placementStart.value || !placementRect.value || !isBlackboardEditPointer(event))
    return

  event.preventDefault()
  event.stopPropagation()
  const rect = placementRect.value
  if (rect.width >= 8 && rect.height >= 8)
    insertExhibit(pendingExhibit.value, rect)

  placementStart.value = undefined
  placementRect.value = undefined
}

function cancelPlacement() {
  placementStart.value = undefined
  placementRect.value = undefined
  cancelExhibitPlacement()
}

function beginExhibitErase(event: PointerEvent) {
  if (drawingMode.value !== 'eraseLine' || pendingExhibit.value || !canEdit.value || !isBlackboardEditPointer(event))
    return

  const point = boardPoint(event)
  erasePoint.value = point
  eraseExhibitsBetweenPoints(point, point)
}

function updateExhibitErase(event: PointerEvent) {
  if (drawingMode.value !== 'eraseLine' || pendingExhibit.value || !canEdit.value || !erasePoint.value || !isBlackboardEditPointer(event))
    return

  const point = boardPoint(event)
  eraseExhibitsBetweenPoints(erasePoint.value, point)
  erasePoint.value = point
}

function endExhibitErase() {
  erasePoint.value = undefined
}

function handleSurfacePointerDown(event: PointerEvent) {
  beginTouchSwipe(event)
  beginExhibitErase(event)
}

function handleSurfacePointerMove(event: PointerEvent) {
  updateExhibitErase(event)
}

function handleSurfacePointerUp(event: PointerEvent) {
  finishTouchSwipe(event)
  endExhibitErase()
}

function handleSurfacePointerCancel(event: PointerEvent) {
  cancelTouchSwipe(event)
  endExhibitErase()
}

function mountBoard() {
  if (!blackboardsEnabled)
    return

  if (!svg.value || !board.value || drauu.mounted)
    return

  drauu.mount(svg.value, board.value)
  load()
}

onMounted(() => {
  if (blackboardsEnabled)
    mountBoard()
})

watch(isOpen, async (open) => {
  if (!blackboardsEnabled || !open)
    return

  await nextTick()
  mountBoard()
  load()
})

watch(pendingExhibit, () => {
  placementStart.value = undefined
  placementRect.value = undefined
})

onBeforeUnmount(() => {
  drauu.unmount()
})
</script>

<template>
  <Teleport v-if="blackboardsEnabled" to="body">
    <section
      v-show="isOpen"
      class="slidev-blackboard"
      :class="boardThemeClass"
      aria-label="Blackboard"
    >
      <div
        ref="board"
        class="slidev-blackboard__surface"
        :style="boardStyle"
        @pointerdown.capture="handleSurfacePointerDown"
        @pointermove.capture="handleSurfacePointerMove"
        @pointerup.capture="handleSurfacePointerUp"
        @pointercancel.capture="handleSurfacePointerCancel"
      >
          <svg
            v-if="referenceLayerVisible && referenceBoard"
            class="slidev-blackboard__reference"
            :style="{ opacity: guideOpacity }"
            :viewBox="`0 0 ${canvasWidth} ${canvasHeight}`"
            preserveAspectRatio="none"
            v-html="referenceBoard.drawing"
          />

        <svg
          ref="svg"
          class="slidev-blackboard__drawing"
          :viewBox="`0 0 ${canvasWidth} ${canvasHeight}`"
          preserveAspectRatio="none"
        />

        <div
          v-if="pendingExhibit"
          class="slidev-blackboard__placement"
          @pointerdown="beginPlacementDrag"
          @pointermove="updatePlacementDrag"
          @pointerup="finishPlacementDrag"
          @pointercancel="cancelPlacement"
          @contextmenu.prevent="cancelPlacement"
        >
          <svg
            v-if="placementRect"
            class="slidev-blackboard__placement-preview"
            :viewBox="`0 0 ${canvasWidth} ${canvasHeight}`"
            preserveAspectRatio="none"
          >
            <rect
              class="slidev-blackboard__placement-box"
              :x="placementRect.x"
              :y="placementRect.y"
              :width="placementRect.width"
              :height="placementRect.height"
            />
            <g :transform="placementPreviewTransform" v-html="pendingExhibit.svg" />
          </svg>
        </div>
      </div>

      <BlackboardDrawingControls v-if="canEdit" @close="close" />
      <BlackboardExhibitPicker />
    </section>
  </Teleport>
</template>
