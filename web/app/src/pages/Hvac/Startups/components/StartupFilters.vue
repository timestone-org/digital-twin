<script setup lang="ts">
/**
 * @fileoverview 开机事件的工具条：车间 / 房间 / 结果 / 运行组合四个筛选器。
 *
 * ⚠ 「运行组合」是全页唯一的组合筛选器——左栏点选也写回这里。它与左栏各记一份
 * 的话，两边迟早对不上，而对不上时看着都很正常。
 */
import { computed } from 'vue'
import type { CombinationCoverage, DtSelectOption } from '@dt/contracts'
import { DtSelect } from '@dt/ui'

import { combinationOptions, outcomeOptions } from '../scripts/startupView'

const props = defineProps<{
  workshopId: string
  workshopOptions: readonly DtSelectOption[]
  roomId: string
  roomOptions: readonly DtSelectOption[]
  outcome: string
  combination: string
  coverage: readonly CombinationCoverage[]
}>()

const emit = defineEmits<{
  'update:workshopId': [value: string]
  'update:roomId': [value: string]
  'update:outcome': [value: string]
  'update:combination': [value: string]
}>()

const combinations = computed(() => combinationOptions(props.coverage))
</script>

<template>
  <div class="flex shrink-0 flex-wrap items-end gap-3">
    <DtSelect
      class="w-44"
      size="sm"
      :model-value="props.workshopId"
      label="车间"
      :options="props.workshopOptions"
      @update:model-value="emit('update:workshopId', $event)"
    />
    <DtSelect
      class="w-44"
      size="sm"
      :model-value="props.roomId"
      label="房间"
      :disabled="props.workshopId === ''"
      :options="props.roomOptions"
      @update:model-value="emit('update:roomId', $event)"
    />
    <DtSelect
      class="w-40"
      size="sm"
      :model-value="props.outcome"
      label="结果"
      :options="outcomeOptions()"
      @update:model-value="emit('update:outcome', $event)"
    />
    <DtSelect
      class="w-56"
      size="sm"
      :model-value="props.combination"
      label="运行组合"
      :options="combinations"
      @update:model-value="emit('update:combination', $event)"
    />
  </div>
</template>
