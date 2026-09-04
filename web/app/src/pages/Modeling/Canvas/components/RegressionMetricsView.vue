<script setup lang="ts">
/**
 * @fileoverview 回归这一屏的图：真值-预测、预测-残差两张散点 + 残差直方图
 * （设计规格 §5-20、§5-22）。指标卡在派发外壳 `MetricsView.vue` 上。
 */
import { DtNotice } from '@dt/ui'
import { computed } from 'vue'

import type { HistogramMark, NormalCurve } from '../scripts/histogramGeometry'
import type { ScatterBand, ScatterSeries } from '../scripts/scatterGeometry'
import type { MetricsPreview } from '../scripts/preview'

import HistogramChart from './HistogramChart.vue'
import ScatterPlot from './ScatterPlot.vue'

const props = defineProps<{ preview: MetricsPreview }>()

/** 残差图上那条线；落在数据范围之外时直方图自己会改成一行字，不画到框外去。 */
const RESIDUAL_MARKS: HistogramMark[] = [
  { at: 0, label: '零误差', intent: 'warning' },
]

/**
 * 同均值同方差的正态参考曲线。
 *
 * ⚠ 两个参数就在同一份 metrics 里：残差分析算子产出的偏均值与离散度，今天只印
 * 成两个数字，与那张直方图互不相干（规格 §5-22）。
 */
const residualCurve = computed<NormalCurve | null>(() => {
  const table = new Map(props.preview.metrics)
  const mean = table.get('residual_mean')
  const sd = table.get('residual_std')
  if (typeof mean !== 'number' || typeof sd !== 'number') return null
  return { mean, sd }
})

/** 真值（横）对预测值（纵）：一路点，理想线由 pairs 态自己画。 */
const truthSeries = computed<ScatterSeries[]>(() => [
  { name: '预测值', points: props.preview.pairs },
])

/**
 * 预测值（横）对残差（纵）。
 *
 * ⚠ 这张图是回归诊断的第一张：残差随预测值变大而变大 = 异方差，R² 一点也
 * 看不出来（规格 §5-20）。数据就是同一份 pairs，不必再接一个评估算子。
 */
const residualSeries = computed<ScatterSeries[]>(() => [
  {
    name: '残差',
    points: props.preview.pairs.map(
      ([truth, guess]) => [guess, truth - guess] as const,
    ),
  },
])

/** ±1σ 带；两个参数就在同一份 metrics 里，缺一个就不画。 */
const residualBand = computed<ScatterBand | null>(() => {
  const curve = residualCurve.value
  if (curve === null || !(curve.sd > 0)) return null
  return {
    low: curve.mean - curve.sd,
    high: curve.mean + curve.sd,
    label: '±1σ',
  }
})

const hasPairs = computed(() => props.preview.pairs.length > 0)
</script>

<template>
  <div class="dt-ml-regress">
    <DtNotice v-if="props.preview.isPairsTrimmed" intent="info">
      这一步的结果摘要太大，画散点用的那些点没有一起带回来——这里少一张图，不是
      一个点都没有。指标不靠这些点算。
    </DtNotice>
    <div class="dt-ml-regress__plots">
      <ScatterPlot
        v-if="hasPairs"
        mode="pairs"
        :series="truthSeries"
        caption="真值（横）对预测值（纵）—— 点越贴近虚线越准"
        x-label="真值"
        y-label="预测值"
        :is-truncated="props.preview.isPairsTruncated"
      />
      <ScatterPlot
        v-if="hasPairs"
        mode="residual"
        :series="residualSeries"
        caption="预测值（横）对残差（纵）—— 散布随预测值变宽就是异方差"
        x-label="预测值"
        y-label="残差（真值 − 预测值）"
        :band="residualBand"
        :is-truncated="props.preview.isPairsTruncated"
      />
      <HistogramChart
        v-if="props.preview.residualBins.length > 0"
        :bins="props.preview.residualBins"
        caption="残差分布（真值 − 预测值）—— 越集中在 0 附近越好"
        axis-label="残差"
        :marks="RESIDUAL_MARKS"
        :curve="residualCurve"
      />
    </div>
  </div>
</template>

<style scoped lang="scss">
.dt-ml-regress {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;

  &__plots {
    // 图的宽度上限归摆图的这一区给，图元件自己不焊死（规格 §3.2 的主体图宽度）
    --dt-ml-chart-max: min(44rem, 100%);

    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
    align-items: flex-start;
  }
}
</style>
