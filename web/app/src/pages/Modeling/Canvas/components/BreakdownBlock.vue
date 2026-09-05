<script setup lang="ts">
/**
 * @fileoverview 「按项的一组数」这一块的画法：标量档走 ② 区那套指标卡，成组的
 * 数摆横条，概率侧那四块（ROC / PR / 校准 / 阈值网格）另有各自的画法。
 *
 * ⚠ 两档不能合并：标量档那几个数量纲各不相同（棵 / 层 / 个 / R²），共用一根轴
 * 之后 R²=0.99 会缩成叶子总数旁边看不见的一丝——而那两个数正是这一块要说的事。
 * ⚠ 单位只认 payload 给的那个，一处都不查阈值表与单位表——指标卡也按 `column`
 * 档摆：列名当指标键塞进扁平字典是键空间冲突，某列恰好叫 `mape` 时无量纲的数会
 * 被印上百分号，叫 `r2` 时还会被套上回归阈值染色（规格 §4.3、R-34）。
 */
import { DtEmpty } from '@dt/ui'
import { computed } from 'vue'

import { buildBreakdown } from '../scripts/breakdownParts'
import { buildCurve } from '../scripts/probabilityCurves'
import type { ReportBlock } from '../scripts/reportBlocks'
import { curveKindOf } from '../scripts/reportBlocks'

import BarList from './BarList.vue'
import ScatterPlot from './ScatterPlot.vue'
import StatCards from './StatCards.vue'
import ThresholdSlider from './ThresholdSlider.vue'

const props = defineProps<{ block: ReportBlock }>()

const view = computed(() =>
  buildBreakdown(props.block.payload, props.block.tier),
)

/** 概率侧那四块按逐项的键认；认不出的一律走横条那条老路。 */
const kind = computed(() => curveKindOf(props.block.payload))

const curve = computed(() => {
  const found = kind.value
  if (found === null || found === 'grid') return null
  return buildCurve(props.block.payload, found)
})

/**
 * 横条那套算料只服务横条。
 *
 * ⚠ 曲线上照搬那几句会句句是错话：那行结论会把「最高的一档 F1」说成这张图的
 * 结论，而顶格告警在 ROC 上恒真——它的点数按构造就是上限那么多，后端一个点都
 * 没截（`evalcurves.py::GRID_POINTS` 特意给锚点让了一格）。
 */
const isPlain = computed(() => kind.value === null)
</script>

<template>
  <section class="dt-ml-breakdown">
    <p class="dt-ml-breakdown__title">{{ props.block.title }}</p>
    <p v-if="view.caption !== ''" class="dt-ml-breakdown__caption">
      {{ view.caption }}
    </p>
    <DtEmpty
      v-if="view.isEmpty"
      size="inline"
      title="这一块一项数都没有"
      hint="不是算成了 0，是这一步压根没产出可列的项"
    />
    <ThresholdSlider
      v-else-if="kind === 'grid'"
      :payload="props.block.payload"
    />
    <ScatterPlot
      v-else-if="curve !== null"
      mode="curve"
      :series="curve.series"
      :rules="curve.rules"
      :x-label="curve.xLabel"
      :y-label="curve.yLabel"
      :diagonal="curve.diagonal"
      :note="curve.note"
    />
    <StatCards v-else-if="view.isCards" :items="view.cards" space="column" />
    <BarList
      v-else
      :items="view.rows"
      :unit="view.unit"
      :reference="view.reference"
      empty-text="这一块一项数都没有"
    />
    <p v-if="isPlain && view.summary !== ''" class="dt-ml-breakdown__summary">
      {{ view.summary }}
    </p>
    <p v-if="isPlain && view.strayNote !== ''" class="dt-ml-breakdown__note">
      {{ view.strayNote }}
    </p>
    <p v-if="isPlain && view.capNote !== ''" class="dt-ml-breakdown__cut">
      {{ view.capNote }}
    </p>
    <p
      v-for="note in view.notes"
      :key="note.text"
      class="dt-ml-breakdown__note"
      :class="`dt-ml-breakdown__note--${note.level}`"
    >
      {{ note.text }}
    </p>
  </section>
</template>

<style scoped lang="scss">
.dt-ml-breakdown {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;

  &__title {
    margin: 0;
    color: var(--text-primary);
    font-size: var(--ctl-hint-fs-md);
    font-weight: 600;
  }

  &__caption,
  &__summary,
  &__note {
    color: var(--text-secondary);
    font-size: var(--ctl-hint-fs-sm);
  }

  // 会让人读出错误结论的那一句整条摆出来，不收进小问号（规格 §11 的 R-24）
  &__note--alert {
    padding: 0.375rem 0.5rem;
    border: 1px solid var(--state-warning);
    border-radius: var(--radius-sm);
    background: rgba(var(--state-warning-rgb), 0.08);
    color: var(--text-primary);
  }

  &__caption,
  &__summary,
  &__note,
  &__cut {
    margin: 0;
  }

  &__summary {
    color: var(--text-primary);
  }

  &__cut {
    color: var(--state-warning);
    font-size: var(--ctl-hint-fs-sm);
  }
}
</style>
