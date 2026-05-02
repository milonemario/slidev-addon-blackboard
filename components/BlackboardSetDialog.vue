<script setup lang="ts">
import IconButton from '@slidev/client/internals/IconButton.vue'
import { computed, ref } from 'vue'
import { useBlackboard } from '../composables/useBlackboard'

type BlackboardSetKind = 'guide' | 'prefilled-live' | 'saved-live'
type BlackboardSetDialogMode = 'save' | 'load' | 'reset'
type BlackboardSetTargetMode = 'existing' | 'new'

const {
  blackboardEditMode,
  boardTheme,
  canEditGuides,
  canSaveGuides,
  canSavePrefilledLiveBoards,
  exportBlackboardSets,
  loadBlackboardSetIntoCurrentMode,
  loadExportBlackboardSets,
  resetLiveFromPrefilled,
  saveCurrentBlackboardsToSet,
} = useBlackboard()

const setKindLabels: Record<BlackboardSetKind, string> = {
  guide: 'guides',
  'prefilled-live': 'pre-made live blackboards',
  'saved-live': 'saved live blackboards',
}

const setKindIcons: Record<BlackboardSetKind, string> = {
  guide: 'i-carbon:layers',
  'prefilled-live': 'i-carbon:screen',
  'saved-live': 'i-carbon:archive',
}

const setDialog = ref<{
  busy: boolean
  error: string
  mode: BlackboardSetDialogMode
  newName: string
  open: boolean
  selectedKey: string
  selectedKind: BlackboardSetKind
  targetMode: BlackboardSetTargetMode
}>({
  busy: false,
  error: '',
  mode: 'load',
  newName: '',
  open: false,
  selectedKey: '',
  selectedKind: 'guide',
  targetMode: 'existing',
})

function setChoices(kind?: BlackboardSetKind) {
  return exportBlackboardSets.value.filter(set => (
    set.kind !== 'current-live'
    && (set.kind !== 'guide' || canEditGuides.value)
    && (!kind || set.kind === kind)
  ))
}

function setKindOptionsForMode(mode: BlackboardSetDialogMode): BlackboardSetKind[] {
  if (mode === 'reset')
    return ['prefilled-live']
  if (mode === 'save') {
    const kinds: BlackboardSetKind[] = []
    if (blackboardEditMode.value === 'guide') {
      if (canSaveGuides.value)
        kinds.push('guide')
    }
    else if (canSavePrefilledLiveBoards.value) {
      kinds.push('prefilled-live', 'saved-live')
    }
    return kinds
  }

  return [
    ...(canEditGuides.value ? ['guide' as const] : []),
    'prefilled-live',
    'saved-live',
  ]
}

const setDialogKindOptions = computed<BlackboardSetKind[]>(() => setKindOptionsForMode(setDialog.value.mode))
const setDialogSets = computed(() => setChoices(setDialog.value.selectedKind))
const setDialogSelectedSet = computed(() => (
  setDialogSets.value.find(set => set.key === setDialog.value.selectedKey)
))
const setDialogTitle = computed(() => {
  if (setDialog.value.mode === 'save')
    return blackboardEditMode.value === 'guide' ? 'Save Guides' : 'Save Live Blackboards'
  if (setDialog.value.mode === 'reset')
    return 'Reset Live Blackboards'

  return 'Load Blackboard Set'
})
const setDialogPrimaryLabel = computed(() => {
  if (setDialog.value.busy)
    return 'Working'
  if (setDialog.value.mode === 'save')
    return 'Save'
  if (setDialog.value.mode === 'reset')
    return 'Reset Live'

  return 'Load'
})
const setDialogCanSubmit = computed(() => {
  if (setDialog.value.busy)
    return false
  if (setDialog.value.mode === 'save' && setDialog.value.targetMode === 'new')
    return setDialog.value.newName.trim().length > 0

  return !!setDialogSelectedSet.value
})

function defaultSetKind(mode: BlackboardSetDialogMode) {
  if (mode === 'reset')
    return 'prefilled-live'
  if (mode === 'save') {
    return blackboardEditMode.value === 'guide' ? 'guide' : 'saved-live'
  }

  const preferred = blackboardEditMode.value === 'guide' ? 'guide' : 'saved-live'
  const safePreferred = preferred === 'guide' && !canEditGuides.value ? 'saved-live' : preferred
  return setChoices(safePreferred).length ? safePreferred : setKindOptionsForMode(mode).find(kind => setChoices(kind).length) || safePreferred
}

function defaultNewSetName(kind: BlackboardSetKind) {
  const date = new Date().toISOString().slice(0, 10)
  if (kind === 'guide')
    return `Guides ${date}`
  if (kind === 'prefilled-live')
    return `Pre-made live ${date}`

  return `Presentation ${date}`
}

function selectDefaultSetForKind(kind: BlackboardSetKind) {
  const choices = setChoices(kind)
  setDialog.value.selectedKey = choices.find(set => set.active)?.key || choices[0]?.key || ''
  if (setDialog.value.mode === 'save' && !choices.length)
    setDialog.value.targetMode = 'new'
  else if (setDialog.value.mode !== 'save')
    setDialog.value.targetMode = 'existing'
  setDialog.value.newName = defaultNewSetName(kind)
}

function selectSetDialogKind(kind: BlackboardSetKind) {
  setDialog.value.selectedKind = kind
  setDialog.value.error = ''
  selectDefaultSetForKind(kind)
}

async function open(mode: BlackboardSetDialogMode) {
  await loadExportBlackboardSets()
  const kind = defaultSetKind(mode)
  setDialog.value = {
    busy: false,
    error: '',
    mode,
    newName: defaultNewSetName(kind),
    open: true,
    selectedKey: '',
    selectedKind: kind,
    targetMode: mode === 'save' && !setChoices(kind).length ? 'new' : 'existing',
  }
  selectDefaultSetForKind(kind)
}

function closeSetDialog() {
  if (setDialog.value.busy)
    return

  setDialog.value.open = false
  setDialog.value.error = ''
}

async function submitSetDialog() {
  if (!setDialogCanSubmit.value)
    return

  setDialog.value.busy = true
  setDialog.value.error = ''
  try {
    if (setDialog.value.mode === 'save') {
      const target = setDialog.value.targetMode === 'new'
        ? { name: setDialog.value.newName.trim() }
        : { id: setDialogSelectedSet.value?.id }
      const saved = await saveCurrentBlackboardsToSet(setDialog.value.selectedKind, target)
      if (!saved) {
        setDialog.value.error = 'Could not save this blackboard set.'
        return
      }
    }
    else if (setDialog.value.mode === 'load') {
      if (!setDialogSelectedSet.value) {
        setDialog.value.error = 'Choose a blackboard set to load.'
        return
      }
      const loaded = await loadBlackboardSetIntoCurrentMode(setDialogSelectedSet.value.key)
      if (!loaded) {
        setDialog.value.error = 'Could not load this blackboard set.'
        return
      }
    }
    else {
      if (!setDialogSelectedSet.value) {
        setDialog.value.error = 'Choose a pre-made live set.'
        return
      }
      const reset = await resetLiveFromPrefilled(setDialogSelectedSet.value.key)
      if (!reset) {
        setDialog.value.error = 'Could not reset live blackboards from this set.'
        return
      }
    }

    setDialog.value.open = false
    setDialog.value.error = ''
  }
  finally {
    setDialog.value.busy = false
  }
}

defineExpose({
  open,
})

</script>

<template>
  <Teleport to="body">
    <div
      v-if="setDialog.open"
      class="slidev-blackboard-set-dialog"
      :class="{ 'slidev-blackboard--whiteboard': boardTheme === 'whiteboard' }"
      @pointerdown.stop
    >
      <div class="slidev-blackboard-set-dialog__backdrop" @click="closeSetDialog" />

      <section
        class="slidev-blackboard-set-dialog__panel"
        role="dialog"
        aria-modal="true"
        :aria-label="setDialogTitle"
      >
        <header class="slidev-blackboard-set-dialog__header">
          <h2>{{ setDialogTitle }}</h2>
          <button
            type="button"
            class="slidev-blackboard-set-dialog__icon-button"
            title="Close"
            :disabled="setDialog.busy"
            @click="closeSetDialog"
          >
            <div class="i-carbon:close" />
          </button>
        </header>

        <div class="slidev-blackboard-set-dialog__body">
          <section class="slidev-blackboard-set-dialog__field">
            <div class="slidev-blackboard-set-dialog__label">
              Type
            </div>
            <div class="slidev-blackboard-set-dialog__segmented">
              <button
                v-for="kind of setDialogKindOptions"
                :key="kind"
                type="button"
                :class="{ active: setDialog.selectedKind === kind }"
                @click="selectSetDialogKind(kind)"
              >
                <div :class="setKindIcons[kind]" />
                <span>{{ setKindLabels[kind] }}</span>
              </button>
            </div>
          </section>

          <section
            v-if="setDialog.mode === 'save'"
            class="slidev-blackboard-set-dialog__field"
          >
            <div class="slidev-blackboard-set-dialog__label">
              Version
            </div>
            <div class="slidev-blackboard-set-dialog__segmented">
              <button
                type="button"
                :class="{ active: setDialog.targetMode === 'existing' }"
                :disabled="setDialogSets.length === 0"
                @click="setDialog.targetMode = 'existing'"
              >
                <div class="i-carbon:document" />
                <span>Existing</span>
              </button>
              <button
                type="button"
                :class="{ active: setDialog.targetMode === 'new' }"
                @click="setDialog.targetMode = 'new'"
              >
                <div class="i-carbon:add-alt" />
                <span>New</span>
              </button>
            </div>
          </section>

          <section
            v-if="setDialog.mode !== 'save' || setDialog.targetMode === 'existing'"
            class="slidev-blackboard-set-dialog__field"
          >
            <div class="slidev-blackboard-set-dialog__label">
              Set
            </div>
            <div
              v-if="setDialogSets.length"
              class="slidev-blackboard-set-dialog__set-list"
            >
              <button
                v-for="set of setDialogSets"
                :key="set.key"
                type="button"
                :class="{ active: setDialog.selectedKey === set.key }"
                @click="setDialog.selectedKey = set.key"
              >
                <span class="slidev-blackboard-set-dialog__set-name">
                  {{ set.name }}
                </span>
                <span class="slidev-blackboard-set-dialog__set-meta">
                  {{ set.boardCount }} boards<span v-if="set.active"> · active</span>
                </span>
              </button>
            </div>
            <p v-else class="slidev-blackboard-set-dialog__empty">
              No {{ setKindLabels[setDialog.selectedKind] }} versions are available.
            </p>
          </section>

          <label
            v-if="setDialog.mode === 'save' && setDialog.targetMode === 'new'"
            class="slidev-blackboard-set-dialog__field"
          >
            <span class="slidev-blackboard-set-dialog__label">New Version Name</span>
            <input
              v-model="setDialog.newName"
              class="slidev-blackboard-set-dialog__input"
              type="text"
              autocomplete="off"
              @keydown.enter.prevent="submitSetDialog"
            >
          </label>

          <p
            v-if="setDialog.mode === 'reset'"
            class="slidev-blackboard-set-dialog__warning"
          >
            Resetting replaces the current live blackboards with the selected pre-made live version.
          </p>

          <p
            v-if="setDialog.error"
            class="slidev-blackboard-set-dialog__error"
          >
            {{ setDialog.error }}
          </p>
        </div>

        <footer class="slidev-blackboard-set-dialog__footer">
          <button
            type="button"
            class="slidev-blackboard-set-dialog__button"
            :disabled="setDialog.busy"
            @click="closeSetDialog"
          >
            Cancel
          </button>
          <button
            type="button"
            class="slidev-blackboard-set-dialog__button is-primary"
            :disabled="!setDialogCanSubmit"
            @click="submitSetDialog"
          >
            {{ setDialogPrimaryLabel }}
          </button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>
