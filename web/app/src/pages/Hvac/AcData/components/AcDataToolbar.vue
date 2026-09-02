<script setup lang="ts">
/**
 * @fileoverview 顶部工具条：数据集页签、时间区间与呈现方式。
 * 区间的两端都是 UTC RFC3339，本地时的显示由 DtDateTimeInput 自己换算。
 */
import type { DtSegmentedOption, DtSelectOption } from '@dt/contracts'
import { DtButton, DtDateTimeInput, DtSegmented, DtSelect } from '@dt/ui'

import type { AcDataView } from '../scripts/useAcDataView'
import type { RangePreset } from '../scripts/acDataQuery'

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
      size="sm"
      :model-value="datasetKey"
      label="数据集"
      :options="datasetOptions"
      @update:model-value="emit('update:datasetKey', $event)"
    />
    <!-- ⚠ 整行统一 sm：不给 size 的话控件落回 md（40px），紧挨着的预设键是
       sm（32px），同一行差 8px 一眼就能看出来 -->
    <!-- ⚠ 宽度套在外层 div 上，不写在组件的 class 上：DtDateTimeInput 与
       DtInput 一样是 inheritAttrs:false + v-bind="$attrs"，class 会落到里面
       那个 <input> 上，外框反而不受约束 -->
    <div class="w-52">
      <DtDateTimeInput
        size="sm"
        :model-value="from"
        label="开始时间"
        @update:model-value="emit('update:from', $event)"
      />
    </div>
    <div class="w-52">
      <DtDateTimeInput
        size="sm"
        :model-value="to"
        label="结束时间"
        @update:model-value="emit('update:to', $event)"
      />
    </div>
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
      size="sm"
      :model-value="view"
      :options="VIEW_OPTIONS"
      aria-label="呈现方式"
      @update:model-value="onView"
    />
    <!-- 区间错误单独占一行：塞进某个控件下面会把那一格撑高，整行控件跟着错位 -->
    <p
      v-if="rangeError"
      class="m-0 basis-full text-xs text-state-danger"
      role="alert"
    >
      {{ rangeError }}
    </p>
  </div>
</template>
