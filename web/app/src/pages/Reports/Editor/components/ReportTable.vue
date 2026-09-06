<script setup lang="ts">
/** @fileoverview 台账表格试算的完整可见行。 */
import { computed } from 'vue'
import { DtTable } from '@dt/ui'
import type { ReportSchemas } from '@dt/contracts'
const props = defineProps<{ node: ReportSchemas['NodeValue'] }>()
const columns = computed(() =>
  (props.node.columns ?? []).map((label, index) => ({
    key: `column${index}`,
    label,
  })),
)
const rows = computed(() =>
  (props.node.rows ?? []).map((row) => ({
    id: row.join('\u001f'),
    values: Object.fromEntries(
      row.map((value, index) => [`column${index}`, value]),
    ),
  })),
)
</script>
<template>
  <DtTable :columns="columns" :rows="rows" min-width="20rem">
    <template
      v-for="column in columns"
      :key="column.key"
      #[`cell-${column.key}`]="{ row }"
    >
      {{ row.values[column.key] }}
    </template>
  </DtTable>
</template>
