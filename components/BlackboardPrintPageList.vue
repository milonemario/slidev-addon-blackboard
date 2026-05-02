<script setup lang="ts">
import { useNav } from '@slidev/client'
import { computed } from 'vue'
import { useBlackboard } from '../composables/useBlackboard'

const {
  canvasHeight,
  canvasWidth,
  exportableBoards,
  printExportBlackboards,
  printExportBlackboardThemeClass,
} = useBlackboard()
const { slides } = useNav()

const gridSize = 56
const pageStyle = computed(() => ({
  height: `${canvasHeight.value}px`,
  width: `${canvasWidth.value}px`,
  '--slidev-blackboard-grid-width': `${(gridSize / (canvasWidth.value || 1400)) * 100}%`,
  '--slidev-blackboard-grid-height': `${(gridSize / (canvasHeight.value || 1000)) * 100}%`,
}))

const shouldRender = computed(() => printExportBlackboards.value && exportableBoards.value.length > 0)
</script>

<template>
  <div
    v-if="shouldRender"
    class="slidev-blackboard-print-pages"
  >
    <section
      v-for="(board, index) of exportableBoards"
      :id="`${String(slides.length + index + 1).padStart(3, '0')}-blackboard`"
      :key="board.id"
      class="print-slide-container slidev-blackboard-print-page"
      :class="printExportBlackboardThemeClass"
      :style="pageStyle"
    >
      <svg
        class="slidev-blackboard-print-page__drawing"
        :viewBox="`0 0 ${canvasWidth} ${canvasHeight}`"
        preserveAspectRatio="none"
        v-html="board.drawing"
      />
    </section>
  </div>
</template>
