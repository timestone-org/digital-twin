<script setup lang="ts">
/**
 * @fileoverview 预测与实际的对比卡：组合过滤 + 散点 + 折外逐条表，共用一页数据。
 */
import { computed } from 'vue'
import type { ModelPrediction } from '@dt/contracts'
import { DtCard, DtSelect } from '@dt/ui'

import type { AsyncList } from '@/composables/useAsyncList'
import { formatSet } from '@/features/hvac/modelView'
import PredictionScatter from './PredictionScatter.vue'
import PredictionTable from './PredictionTable.vue'

const props = defineProps<{
  predictions: AsyncList<ModelPrediction>
  /** 模型的服务组合，过滤下拉的选项。 */
  sets: readonly (readonly string[])[]
  /** 当前过滤的组合键；空串 = 全部。 */
  filter: string
}>()

const emit = defineEmits<{ 'update:filter': [value: string] }>()

const filterOptions = computed(() => [
  { value: '', label: '全部组合' },
  ...props.sets.map((set) => ({
    value: formatSet(set),
    label: formatSet(set),
  })),
])
</script>

<template>
  <DtCard class="min-w-0">
    <div class="mb-2 flex flex-wrap items-center gap-2">
      <h2 class="text-sm font-semibold text-text-primary">
        预测与实际的逐条对比
        <span class="ml-1 text-xs font-normal text-text-secondary">
          全部来自折外预测：模型没见过答案的那次
        </span>
      </h2>
      <DtSelect
        class="ml-auto w-44"
        size="sm"
        :model-value="props.filter"
        :options="filterOptions"
        aria-label="按组合过滤"
        @update:model-value="emit('update:filter', $event)"
      />
    </div>
    <div class="flex min-w-0 flex-col gap-3 lg:flex-row">
      <PredictionScatter :rows="props.predictions.items.value" />
      <PredictionTable
        class="min-w-0 flex-1"
        :rows="props.predictions.items.value"
        :loading="props.predictions.loading.value"
        :error="props.predictions.error.value"
        :pager="props.predictions.pager.value"
        @update:page="props.predictions.goToPage($event)"
        @update:size="props.predictions.setSize($event)"
        @retry="props.predictions.reload()"
      />
    </div>
  </DtCard>
</template>
