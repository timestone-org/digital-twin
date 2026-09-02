<script setup lang="ts">
/**
 * @fileoverview 一次评估的结果视图：指标卡（按阈值染色）+ 散点 + 残差直方图。
 *
 * ⚠ 值为 null 的指标写「无定义」不写 0：R² 在整列取值相同时、MAPE 在真值有 0 时
 * 都是算不出来的，显示成 0 会被读成「一点都不准」。
 */
import { DtNotice, DtTag } from '@dt/ui'
import { computed } from 'vue'

import {
  BAND_INTENTS,
  bandHintOf,
  bandOf,
  labelOf,
  unitOf,
} from '../scripts/metricBands'
import { niceNumber } from '../scripts/numbers'
import type { MetricsPreview } from '../scripts/preview'

import ResidualChart from './ResidualChart.vue'
import ScatterChart from './ScatterChart.vue'

const props = defineProps<{ preview: MetricsPreview }>()

const cards = computed(() =>
  props.preview.metrics.map(([key, value]) => ({
    key,
    label: labelOf(key),
    text: value === null ? '无定义' : `${niceNumber(value)}${unitOf(key)}`,
    intent: BAND_INTENTS[bandOf(key, value)],
    // ⚠ 没有分档口径的指标（MAE / RMSE / 最大误差）不替用户拍颜色：
    // 一个 3 是好是坏，只有知道那一列的量纲才答得上来
    hint: bandHintOf(key) || '好坏取决于这一列的量纲，这里不替你下结论',
  })),
)
</script>

<template>
  <div class="dt-ml-metrics">
    <ul class="dt-ml-metrics__list">
      <li v-for="card in cards" :key="card.key" :title="card.hint">
        <span class="dt-ml-metrics__name">{{ card.label }}</span>
        <DtTag :intent="card.intent" size="sm">{{ card.text }}</DtTag>
      </li>
    </ul>
    <DtNotice v-if="cards.length === 0" intent="warning">
      这一步没有产出任何指标
    </DtNotice>
    <div class="dt-ml-metrics__plots">
      <ScatterChart
        v-if="props.preview.pairs.length > 0"
        :pairs="props.preview.pairs"
        :is-truncated="props.preview.isPairsTruncated"
      />
      <ResidualChart
        v-if="props.preview.residualBins.length > 0"
        :bins="props.preview.residualBins"
      />
    </div>
  </div>
</template>

<style scoped lang="scss">
.dt-ml-metrics {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;

  &__list {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    margin: 0;
    padding: 0;
    list-style: none;

    li {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      min-width: 6rem;
      padding: 0.5rem 0.75rem;
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-sm);
      background: var(--surface-raised);
    }
  }

  &__name {
    color: var(--text-secondary);
    font-size: var(--ctl-hint-fs-sm);
  }

  &__plots {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
    align-items: flex-start;
  }
}
</style>
