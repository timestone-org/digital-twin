<script setup lang="ts">
/**
 * @fileoverview 评估页签的整块内容：出处条、评估卡、折外总览、按组合与逐条。
 *
 * ⚠ 训练中继续显示上一次的评估——半份/空数据比旧数据危险（AC_MODEL_DESIGN §6）。
 * 组合过滤是全页唯一的一个，由父页面持有，这里只转发。
 */
import { computed } from 'vue'
import type { AcModel, ModelPrediction } from '@dt/contracts'
import { DtCard, DtNotice } from '@dt/ui'

import type { useAsyncList } from '@/composables/useAsyncList'
import { isModelBusy, toSetRows } from '@/features/hvac/modelView'
import MetricsSummary from './MetricsSummary.vue'
import OutOfFoldCard from './OutOfFoldCard.vue'
import PredictionTable from './PredictionTable.vue'
import ProvenanceStrip from './ProvenanceStrip.vue'
import SetMetricsTable from './SetMetricsTable.vue'
import type { useOutOfFold } from '../useOutOfFold'

const props = defineProps<{
  model: AcModel
  outOfFold: ReturnType<typeof useOutOfFold>
  predictions: ReturnType<typeof useAsyncList<ModelPrediction>>
  filter: string
}>()
const emit = defineEmits<{ 'update:filter': [value: string] }>()

const setRows = computed(() =>
  props.model.metrics ? toSetRows(props.model.metrics.by_set) : [],
)
</script>

<template>
  <ProvenanceStrip :model="model" />

  <MetricsSummary
    v-if="model.metrics"
    :overall="model.metrics.overall"
    :sample="model.sample_count"
  />
  <DtNotice v-else-if="!isModelBusy(model)" intent="info">
    还没有一次成功的训练。
  </DtNotice>

  <template v-if="model.metrics">
    <OutOfFoldCard
      :out-of-fold="outOfFold"
      :sets="model.serving_sets"
      :filter="filter"
      @update:filter="emit('update:filter', $event)"
    />

    <DtCard v-if="setRows.length > 0" class="min-w-0">
      <h2 class="mb-2 text-sm font-semibold text-text-primary">
        按服务组合
        <span class="ml-1 text-xs font-normal text-text-secondary">
          点一行把上面的图与下面的表都筛到它
        </span>
      </h2>
      <SetMetricsTable
        :rows="setRows"
        :selected="filter"
        @select="emit('update:filter', $event)"
      />
    </DtCard>

    <DtCard class="min-w-0">
      <h2 class="mb-2 text-sm font-semibold text-text-primary">
        折外逐条
        <span class="ml-1 text-xs font-normal text-text-secondary">
          「折」= 这一折训练时模型没见过它，所以这条预测是可信的
        </span>
      </h2>
      <PredictionTable
        :rows="predictions.items.value"
        :loading="predictions.loading.value"
        :error="predictions.error.value"
        :pager="predictions.pager.value"
        @update:page="predictions.goToPage($event)"
        @update:size="predictions.setSize($event)"
        @retry="predictions.reload()"
      />
    </DtCard>
  </template>
</template>
