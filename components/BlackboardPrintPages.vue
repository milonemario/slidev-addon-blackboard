<script setup lang="ts">
import BlackboardPrintPageList from './BlackboardPrintPageList.vue'

defineProps<{
  teleportTo?: string
}>()
</script>

<template>
  <Teleport v-if="teleportTo" :to="teleportTo" defer>
    <BlackboardPrintPageList />
  </Teleport>
  <BlackboardPrintPageList v-else />
</template>
