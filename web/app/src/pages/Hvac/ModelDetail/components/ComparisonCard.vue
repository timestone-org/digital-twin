<script setup lang="ts">
/**
 * @fileoverview 预测与实际的对比卡：散点 + 折外逐条表，共用一份游标页。
 */
import type { ModelPrediction } from '@dt/contracts'
import { DtCard } from '@dt/ui'

import type { CursorPages } from '@/composables/useCursorPages'
import PredictionScatter from './PredictionScatter.vue'
import PredictionTable from './PredictionTable.vue'

const props = defineProps<{
  predictions: CursorPages<ModelPrediction, string>
}>()
</script>

<template>
  <DtCard>
    <h2 class="mb-2 text-sm font-semibold text-text-primary">
      预测与实际的逐条对比
      <span class="ml-1 text-xs font-normal text-text-secondary">
        全部来自折外预测：模型没见过答案的那次
      </span>
    </h2>
    <div class="flex flex-col gap-3 lg:flex-row">
      <PredictionScatter :rows="props.predictions.items.value" />
      <PredictionTable
        class="min-w-0 flex-1"
        :rows="props.predictions.items.value"
        :loading="props.predictions.loading.value"
        :error="props.predictions.problem.value"
        :page="props.predictions.pageNumber.value"
        :has-prev="props.predictions.hasPrev.value"
        :has-next="props.predictions.hasNext.value"
        @prev="props.predictions.prev()"
        @next="props.predictions.next()"
        @retry="props.predictions.refresh()"
      />
    </div>
  </DtCard>
</template>
