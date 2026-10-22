<script setup lang="ts">
/** @fileoverview 一季的温湿度上下限表单。 */
import { DtInput } from '@dt/ui'
import type { LimitRow } from '../scripts/acLimitForm'

const props = defineProps<{ rows: readonly LimitRow[]; season: string }>()
const emit = defineEmits<{ 'update:rows': [value: LimitRow[]] }>()

function update(metric: string, side: 'lower' | 'upper', value: string): void {
  emit(
    'update:rows',
    props.rows.map((row) =>
      row.metric === metric ? { ...row, [side]: value } : row,
    ),
  )
}
</script>

<template>
  <div
    v-for="row in rows"
    :key="row.metric"
    class="flex flex-wrap items-end gap-2"
  >
    <span class="w-32 shrink-0 pb-2 text-xs text-text-primary"
      >{{ row.name }}（{{ row.unit }}）</span
    >
    <DtInput
      :model-value="row.lower"
      class="w-24"
      size="sm"
      inputmode="decimal"
      label="下限"
      :aria-label="`${season}${row.name}下限（${row.unit}）`"
      placeholder="不限"
      @update:model-value="update(row.metric, 'lower', $event)"
    />
    <span class="pb-2 text-text-disabled">～</span>
    <DtInput
      :model-value="row.upper"
      class="w-24"
      size="sm"
      inputmode="decimal"
      label="上限"
      :aria-label="`${season}${row.name}上限（${row.unit}）`"
      placeholder="不限"
      @update:model-value="update(row.metric, 'upper', $event)"
    />
  </div>
</template>
