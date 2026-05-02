<script setup lang="ts">
import IconButton from '@slidev/client/internals/IconButton.vue'
import { computed, ref, watch } from 'vue'
import { useBlackboard, type BlackboardExhibit, type BlackboardRenderedExhibit } from '../composables/useBlackboard'

interface ExhibitPreviewState {
  error?: string
  loading?: boolean
  payload?: BlackboardRenderedExhibit
}

const {
  beginExhibitPlacement,
  canShowExhibits,
  exhibitPickerVisible,
  exhibits,
  loadExhibitPayload,
} = useBlackboard()

const previews = ref<Record<string, ExhibitPreviewState>>({})

const groupedExhibits = computed(() => {
  const groups = new Map<string, BlackboardExhibit[]>()
  exhibits.value.forEach((exhibit) => {
    const category = exhibit.category || 'General'
    groups.set(category, [...(groups.get(category) || []), exhibit])
  })

  return Array.from(groups.entries()).map(([category, items]) => ({
    category,
    items,
  }))
})

async function ensurePreview(exhibit: BlackboardExhibit) {
  const current = previews.value[exhibit.id]
  if (current?.loading || current?.payload || current?.error)
    return

  previews.value = {
    ...previews.value,
    [exhibit.id]: { loading: true },
  }

  try {
    const payload = await loadExhibitPayload(exhibit)
    previews.value = {
      ...previews.value,
      [exhibit.id]: { payload },
    }
  }
  catch (error) {
    previews.value = {
      ...previews.value,
      [exhibit.id]: {
        error: error instanceof Error ? error.message : 'Unsupported exhibit',
      },
    }
  }
}

watch([exhibitPickerVisible, exhibits], ([visible]) => {
  if (!visible)
    return

  exhibits.value.forEach(exhibit => ensurePreview(exhibit))
}, { deep: true, immediate: true })
</script>

<template>
  <div
    v-if="canShowExhibits && exhibitPickerVisible"
    class="slidev-blackboard-exhibit__toolbar-wrap"
  >
    <div class="slidev-blackboard-exhibit__toolbar" @pointerdown.stop>
      <div class="slidev-blackboard-exhibit__header">
        <div class="slidev-blackboard-exhibit__title">
          <div class="i-carbon:data-vis-4" />
          <span>Exhibits</span>
        </div>

        <IconButton title="Close exhibits" @click="exhibitPickerVisible = false">
          <div class="i-carbon:close" />
        </IconButton>
      </div>

      <div class="slidev-blackboard-exhibit__groups">
        <section v-for="group of groupedExhibits" :key="group.category" class="slidev-blackboard-exhibit__group">
          <div class="slidev-blackboard-exhibit__category">
            {{ group.category }}
          </div>

          <div class="slidev-blackboard-exhibit__grid">
            <button
              v-for="exhibit of group.items"
              :key="exhibit.id"
              class="slidev-blackboard-exhibit__item"
              type="button"
              :title="exhibit.title"
              @click="beginExhibitPlacement(exhibit)"
            >
              <span class="slidev-blackboard-exhibit__preview-shell">
                <svg
                  v-if="previews[exhibit.id]?.payload"
                  class="slidev-blackboard-exhibit__preview"
                  :viewBox="`0 0 ${previews[exhibit.id].payload?.width || 1} ${previews[exhibit.id].payload?.height || 1}`"
                  preserveAspectRatio="xMidYMid meet"
                  v-html="previews[exhibit.id].payload?.svg"
                />
                <span v-else-if="previews[exhibit.id]?.error" class="slidev-blackboard-exhibit__error">
                  Unsupported exhibit
                </span>
                <span v-else class="slidev-blackboard-exhibit__loading" />
              </span>

              <span class="slidev-blackboard-exhibit__label">
                {{ exhibit.title }}
              </span>
            </button>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>
