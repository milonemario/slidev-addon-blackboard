<script setup lang="ts">
import SlidevExport from '@slidev/client/pages/export.vue'
import BlackboardExportToggle from '../components/BlackboardExportToggle.vue'
import BlackboardPrintPages from '../components/BlackboardPrintPages.vue'
</script>

<template>
  <SlidevExport />
  <BlackboardExportToggle />
  <BlackboardPrintPages teleport-to="#export-content" />
</template>
