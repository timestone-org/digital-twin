<script setup lang="ts">
/**
 * @fileoverview 台账筛选条：关键字 + 车间 + 房间。
 * ⚠ 房间选择器在没选车间时禁用而不是列出全场房间：全场同名房间是常态
 * （两个车间各有一间「配电房」），只给房间名根本分不出是哪一间。
 */
import type { DtSelectOption } from '@dt/contracts'
import { DtIcon, DtInput, DtSelect } from '@dt/ui'

const props = defineProps<{
  keyword: string
  workshopId: string
  roomId: string
  workshopOptions: readonly DtSelectOption[]
  roomOptions: readonly DtSelectOption[]
}>()

const emit = defineEmits<{
  'update:keyword': [value: string]
  'update:workshopId': [value: string]
  'update:roomId': [value: string]
}>()
</script>

<template>
  <div class="flex flex-wrap items-end gap-3">
    <!-- ⚠ 宽度落在外层 div 上：DtInput / DtSelect 都是 inheritAttrs: false，
       class 会被透传到内层原生控件上，量出来的宽度不是这一格的宽度 -->
    <div class="w-56">
      <DtInput
        :model-value="props.keyword"
        size="sm"
        type="search"
        placeholder="搜序号或名称"
        aria-label="搜索空调"
        @update:model-value="emit('update:keyword', $event)"
      >
        <template #leading><DtIcon name="search" :size="14" /></template>
      </DtInput>
    </div>
    <div class="w-40">
      <DtSelect
        :model-value="props.workshopId"
        size="sm"
        aria-label="按车间筛选"
        :options="props.workshopOptions"
        @update:model-value="emit('update:workshopId', $event)"
      />
    </div>
    <div class="w-40">
      <DtSelect
        :model-value="props.roomId"
        size="sm"
        aria-label="按房间筛选"
        :disabled="props.workshopId === ''"
        :options="props.roomOptions"
        @update:model-value="emit('update:roomId', $event)"
      />
    </div>
  </div>
</template>
