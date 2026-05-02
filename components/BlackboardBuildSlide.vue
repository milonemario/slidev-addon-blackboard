<script setup lang="ts">
import { computed } from 'vue'
import { useBlackboard } from '../composables/useBlackboard'

const props = defineProps<{
  boardId: string
}>()

const {
  buildAppendixBlackboardThemeClass,
  buildAppendixBoards,
  canvasHeight,
  canvasWidth,
} = useBlackboard()

const board = computed(() => buildAppendixBoards.value.find(item => item.id === props.boardId))
const gridSize = 56
const pageStyle = computed(() => ({
  '--slidev-blackboard-grid-width': `${(gridSize / (canvasWidth.value || 1400)) * 100}%`,
  '--slidev-blackboard-grid-height': `${(gridSize / (canvasHeight.value || 1000)) * 100}%`,
}))
</script>

<template>
  <section
    v-if="board"
    class="slidev-blackboard-build-page"
    :class="buildAppendixBlackboardThemeClass"
    :style="pageStyle"
    aria-label="Blackboard"
  >
    <svg
      class="slidev-blackboard-build-page__drawing"
      :viewBox="`0 0 ${canvasWidth} ${canvasHeight}`"
      preserveAspectRatio="none"
      v-html="board.drawing"
    />
  </section>
</template>
