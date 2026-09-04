<script setup lang="ts">
/**
 * @fileoverview 一次评估的派发外壳：一排指标卡 + 按摘要里实际有什么分派到
 * 回归 / 分类 / 交叉验证 / 重要性四种子视图（设计规格 §5-20～24）。
 *
 * ⚠ 摘要里没有算子 code，只能按内容分派：五个评估算子的端口都叫 `metrics`、
 * kind 也都是 `metrics`（规格 §4.1）。真正的分派键要等 `ResultView` 把节点的
 * 算子 code 传下来。
 */
import { DtNotice, DtTag } from '@dt/ui'
import { computed } from 'vue'

import {
  BAND_INTENTS,
  bandHintOf,
  bandOf,
  labelOf,
  metricSpaceOf,
  unitOf,
} from '../scripts/metricBands'
import { niceNumber } from '../scripts/numbers'
import type { MetricsPreview } from '../scripts/preview'

import ClassificationMetricsView from './ClassificationMetricsView.vue'
import FoldScoreView from './FoldScoreView.vue'
import ImportanceView from './ImportanceView.vue'
import RegressionMetricsView from './RegressionMetricsView.vue'

const props = defineProps<{ preview: MetricsPreview }>()

type MetricsShape =
  'folds' | 'importance' | 'classification' | 'regression' | 'plain'

// 交叉验证的四个标量一起来一起走（`diagnostics._summary`），认一个就够
const FOLD_KEY = 'score_mean'

const keys = computed(() => props.preview.metrics.map(([key]) => key))

/** 键是指标名还是列名。列名那一档不查阈值表也不拼单位（规格 R-34）。 */
const space = computed(() => metricSpaceOf(keys.value))

/** 四种「有没有东西可看」的判据都不成立才是真的什么都没有。 */
const isBlank = computed(() => {
  const preview = props.preview
  return (
    preview.metrics.length === 0 &&
    preview.pairs.length === 0 &&
    preview.residualBins.length === 0 &&
    preview.labels.length === 0 &&
    preview.matrix.length === 0
  )
})

/**
 * 这份摘要该画成哪一屏。
 *
 * ⚠ 折数那一档要排在分类前面：交叉验证在分类模型上跑出来的 `task` 也是
 * `classification`，按 task 先判会把四个标量画成一张空混淆矩阵。
 */
const shape = computed<MetricsShape>(() => {
  const preview = props.preview
  if (isBlank.value) return 'plain'
  if (space.value === 'column') return 'importance'
  if (keys.value.includes(FOLD_KEY)) return 'folds'
  if (preview.task === 'classification' || preview.labels.length > 0) {
    return 'classification'
  }
  const hasPlots = preview.pairs.length > 0 || preview.residualBins.length > 0
  return hasPlots || preview.task === 'regression' ? 'regression' : 'plain'
})

/** 指标卡只在键是指标名时摆：列名建的键摆成一排灰标签正是这次要治的病。 */
const cards = computed(() =>
  space.value === 'column'
    ? []
    : props.preview.metrics.map(([key, value]) => ({
        key,
        label: labelOf(key),
        text: value === null ? '无定义' : `${niceNumber(value)}${unitOf(key)}`,
        intent: BAND_INTENTS[bandOf(key, value)],
        hint: bandHintOf(key),
      })),
)
</script>

<template>
  <div class="dt-ml-metrics">
    <ul v-if="cards.length > 0" class="dt-ml-metrics__list">
      <li v-for="card in cards" :key="card.key" :title="card.hint">
        <span class="dt-ml-metrics__name">{{ card.label }}</span>
        <DtTag :intent="card.intent" size="sm">{{ card.text }}</DtTag>
      </li>
    </ul>
    <DtNotice v-if="isBlank" intent="warning">
      这一步没有产出任何指标
    </DtNotice>
    <ClassificationMetricsView
      v-if="shape === 'classification'"
      :preview="props.preview"
    />
    <RegressionMetricsView
      v-else-if="shape === 'regression'"
      :preview="props.preview"
    />
    <FoldScoreView
      v-else-if="shape === 'folds'"
      :metrics="props.preview.metrics"
    />
    <ImportanceView
      v-else-if="shape === 'importance'"
      :metrics="props.preview.metrics"
    />
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
}
</style>
