<script setup lang="ts">
import { useBlackboard } from './composables/useBlackboard'

const { blackboardsEnabled, isSyncedOpen, toggle } = useBlackboard()
</script>

<template>
  <button
    v-if="blackboardsEnabled"
    class="slidev-icon-btn slidev-blackboard-nav-button"
    title="Toggle blackboard"
    :aria-pressed="isSyncedOpen"
    @click="toggle"
  >
    <span class="sr-only">Toggle blackboard</span>
    <div class="i-carbon:screen" />
    <span v-if="isSyncedOpen" class="slidev-blackboard-nav-button__active" />
  </button>
</template>
