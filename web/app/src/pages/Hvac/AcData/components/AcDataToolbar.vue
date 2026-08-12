<script setup lang="ts">
/**
 * @fileoverview 顶部工具条：数据集页签、时间区间与呈现方式。
 * 区间的两端都是 UTC RFC3339，本地时的显示由 DtDateTimeInput 自己换算。
 */
import type { DtSegmentedOption, DtSelectOption } from '@dt/contracts'
import { DtButton, DtDateTimeInput, DtSegmented, DtSelect } from '@dt/ui'

import type { AcDataView } from '../useAcDataView'
import type { RangePreset } from '../acDataQuery'

const VIEW_OPTIONS: readonly DtSegmentedOption[] = [
  { value: 'table', label: '表格' },
  { value: 'chart', label: '折线' },
]

defineProps<{
  datasetOptions: readonly DtSelectOption[]
  datasetKey: string
  from: string
  to: string
  view: AcDataView
  presets: readonly RangePreset[]
  rangeError: string | null
}>()

const emit = defineEmits<{
  'update:datasetKey': [value: string]
  'update:from': [value: string]
  'update:to': [value: string]
  'update:view': [value: AcDataView]
  preset: [hours: number]
}>()

/** DtSegmented 的取值是 string；在这里收窄，省一次 `as` 断言。 */
function onView(value: string): void {
  if (value === 'table' || value === 'chart') emit('update:view', value)
}
</script>

<template>
  <div class="flex flex-wrap items-end gap-3">
    <DtSelect
      v-if="datasetOptions.length > 1"
      class="w-44"
      :model-value="datasetKey"
      label="数据集"
      :options="datasetOptions"
      @update:model-value="emit('update:datasetKey', $event)"
    />
    <DtDateTimeInput
      :model-value="from"
      label="开始时间"
      :error="rangeError ?? undefined"
      @update:model-value="emit('update:from', $event)"
    />
    <DtDateTimeInput
      :model-value="to"
      label="结束时间"
      @update:model-value="emit('update:to', $event)"
    />
    <div class="flex items-center gap-1">
      <DtButton
        v-for="preset in presets"
        :key="preset.hours"
        size="sm"
        variant="ghost"
        intent="neutral"
        @click="emit('preset', preset.hours)"
      >
        {{ preset.label }}
      </DtButton>
    </div>
    <DtSegmented
      class="ml-auto"
      :model-value="view"
      :options="VIEW_OPTIONS"
      aria-label="呈现方式"
      @update:model-value="onView"
    />
  </div>
</template>
