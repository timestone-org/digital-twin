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
// ⚠ 行键带上序号：两行取值相同（同样的零读数、没有时间列）很常见，只拿内容
// 拼键会撞键，重新试算时 Vue 打错补丁，旧行混在新结果里。一次试算是一份不变的
// 快照，序号在这一份里是稳定的
const rows = computed(() =>
  (props.node.rows ?? []).map((row, index) => ({
    id: `${index}:${row.join('\u001f')}`,
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
