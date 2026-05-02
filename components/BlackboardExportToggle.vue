<script setup lang="ts">
import { onMounted } from 'vue'
import type { BlackboardBoardTheme } from '../shared/blackboardProtocol'
import { useBlackboard } from '../composables/useBlackboard'

const {
  blackboardsEnabled,
  canExportBlackboards,
  exportBlackboardSetId,
  exportBlackboardSets,
  exportBlackboardTheme,
  exportBlackboardThemeClass,
  exportBlackboards,
  isAutomatedPrintExport,
  loadExportBlackboardSets,
  setExportBlackboardSet,
  setExportBlackboardTheme,
} = useBlackboard()

onMounted(() => {
  void loadExportBlackboardSets()
})

function selectExportSet(event: Event) {
  const id = (event.target as HTMLSelectElement).value
  void setExportBlackboardSet(id)
}

function selectExportTheme(event: Event) {
  const theme = (event.target as HTMLSelectElement).value as BlackboardBoardTheme
  setExportBlackboardTheme(theme)
}
</script>

<template>
  <div
    v-if="blackboardsEnabled && !isAutomatedPrintExport"
    class="slidev-blackboard-export-toggle"
    :class="exportBlackboardThemeClass"
  >
    <label>
      <input
        v-model="exportBlackboards"
        type="checkbox"
        :disabled="!canExportBlackboards"
      >
      <span>Include blackboards</span>
    </label>
    <label class="slidev-blackboard-export-toggle__select-group">
      <span class="slidev-blackboard-export-toggle__select-label">Background</span>
      <select
        class="slidev-blackboard-export-toggle__theme-select"
        :value="exportBlackboardTheme"
        title="Choose blackboard background for export"
        @change="selectExportTheme"
      >
        <option value="whiteboard">
          White
        </option>
        <option value="blackboard">
          Black
        </option>
      </select>
    </label>
    <label class="slidev-blackboard-export-toggle__select-group">
      <span class="slidev-blackboard-export-toggle__select-label">Set</span>
      <select
        :value="exportBlackboardSetId"
        :disabled="!exportBlackboardSets.length"
        title="Choose blackboard set for export"
        @change="selectExportSet"
      >
        <option
          v-for="set of exportBlackboardSets"
          :key="set.key"
          :value="set.key"
        >
          {{ set.name }} ({{ set.boardCount }})
        </option>
      </select>
    </label>
  </div>
</template>
