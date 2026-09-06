<script setup lang="ts">
/**
 * @fileoverview 「模型内部长什么样」这一块的画法：解释方差与载荷（主成分）、
 * 重要性 / 部分依赖 / 训练取值区间 / 代表树（树模型）。六样各自可缺，有哪样画哪样。
 *
 * ⚠ 部分依赖一条曲线一张小图，不并进同一张：每条曲线的横轴是**它自己那一列**的
 * 取值，温度 0–40 与负荷 0–2000 共用一根轴之后，两条曲线都读不出东西。
 * ⚠ 散点也是一张一块：残差图与真值图的横轴是同一个数，摆进同一张之后两片点会
 * 叠在一起，而两者要答的是两回事。
 */
import { DtEmpty } from '@dt/ui'
import { computed } from 'vue'

import { cloudPanels } from '../scripts/fitClouds'
import type { ScatterRule, ScatterSeries } from '../scripts/scatterGeometry'
import type { ReportBlock } from '../scripts/reportBlocks'
import {
  MAX_EXPLAINED,
  MAX_IMPORTANCES,
  MAX_PDP,
  MAX_RANGES,
  capNote,
  explainedView,
  importanceRows,
  importanceSummary,
  loadingsView,
  blockNotes,
  pdpPanels,
  rangeRows,
  rangeSummary,
  treeView,
} from '../scripts/structureParts'

import BarList from './BarList.vue'
import LoadingsGrid from './LoadingsGrid.vue'
import ScatterPlot from './ScatterPlot.vue'
import TreeOutline from './TreeOutline.vue'

const props = defineProps<{ block: ReportBlock }>()

const payload = computed(() => props.block.payload)

const explained = computed(() => explainedView(payload.value))
const loadings = computed(() => loadingsView(payload.value))
const importances = computed(() => importanceRows(payload.value))
const ranges = computed(() => rangeRows(payload.value))
const panels = computed(() => pdpPanels(payload.value))
const clouds = computed(() => cloudPanels(payload.value))
const tree = computed(() => treeView(payload.value))
const notes = computed(() => blockNotes(payload.value))

/** 累计解释方差那条折线连它的「够用了」横线。 */
const cumulative = computed<ScatterSeries[]>(() => [
  { name: '累计解释方差比', points: explained.value.curve, draw: 'both' },
])

const enoughRules = computed<ScatterRule[]>(() => [
  { at: explained.value.enoughRule, label: '80% 够用线', intent: 'reference' },
])

/** 一条曲线一张小图，每张自带一路序列。 */
const curves = computed(() =>
  panels.value.map((one) => ({
    key: one.key,
    name: one.name,
    summary: one.summary,
    series: [
      { name: one.name, points: one.points, draw: 'both' },
    ] satisfies ScatterSeries[],
  })),
)

const summaries = computed(() => ({
  importances: importanceSummary(importances.value),
  ranges: rangeSummary(ranges.value),
}))

/** 顶到上限的那几句实话，各说各的（规格 §2-P5）。 */
const cuts = computed(() => ({
  explained: capNote(explained.value.rows.length, MAX_EXPLAINED, '解释方差'),
  importances: capNote(importances.value.length, MAX_IMPORTANCES, '重要性'),
  pdp: capNote(panels.value.length, MAX_PDP, '部分依赖曲线'),
  ranges: capNote(ranges.value.length, MAX_RANGES, '训练取值区间'),
}))

/** 六样一样都没有：这一块是空的，不是画法漏了（规格 §2-P4）。 */
const isEmpty = computed(
  () =>
    explained.value.isBlank &&
    loadings.value.isBlank &&
    tree.value.isBlank &&
    importances.value.length === 0 &&
    ranges.value.length === 0 &&
    panels.value.length === 0 &&
    clouds.value.length === 0,
)
</script>

<template>
  <section class="dt-ml-structure">
    <p class="dt-ml-structure__title">{{ props.block.title }}</p>
    <DtEmpty
      v-if="isEmpty"
      size="inline"
      title="这一块没有可画的模型内部结构"
      hint="不是画法漏了，是这一步没有带回重要性 / 载荷 / 代表树里的任何一样"
    />
    <div v-if="!explained.isBlank" class="dt-ml-structure__part">
      <p class="dt-ml-structure__part-title">每条轴解释掉多少方差</p>
      <BarList :items="explained.rows" caption="每条轴解释掉的方差比例，0–1" />
      <ScatterPlot
        mode="series"
        :series="cumulative"
        :rules="enoughRules"
        x-label="前几条轴"
        y-label="累计比例"
        caption="累计解释方差"
      />
      <p class="dt-ml-structure__summary">{{ explained.summary }}</p>
      <p v-if="cuts.explained !== ''" class="dt-ml-structure__cut">
        {{ cuts.explained }}
      </p>
    </div>
    <div v-if="!loadings.isBlank" class="dt-ml-structure__part">
      <p class="dt-ml-structure__part-title">载荷：哪几列扛起了这条轴</p>
      <LoadingsGrid :view="loadings" />
      <p class="dt-ml-structure__summary">{{ loadings.summary }}</p>
      <p v-if="loadings.cutNote !== ''" class="dt-ml-structure__cut">
        {{ loadings.cutNote }}
      </p>
    </div>
    <div v-for="one in clouds" :key="one.key" class="dt-ml-structure__part">
      <ScatterPlot
        :mode="one.mode"
        :series="one.series"
        :x-label="one.xLabel"
        :y-label="one.yLabel"
      />
    </div>
    <div v-if="importances.length > 0" class="dt-ml-structure__part">
      <p class="dt-ml-structure__part-title">特征重要性</p>
      <BarList :items="importances" caption="数越大，这一列对预测越关键" />
      <p class="dt-ml-structure__summary">{{ summaries.importances }}</p>
      <p v-if="cuts.importances !== ''" class="dt-ml-structure__cut">
        {{ cuts.importances }}
      </p>
    </div>
    <div v-if="curves.length > 0" class="dt-ml-structure__part">
      <p class="dt-ml-structure__part-title">
        部分依赖：这一列往上走，预测值怎么变
      </p>
      <div class="dt-ml-structure__panels">
        <figure v-for="one in curves" :key="one.key">
          <ScatterPlot
            mode="series"
            :series="one.series"
            :x-label="one.name"
            y-label="预测值"
          />
          <figcaption>{{ one.summary }}</figcaption>
        </figure>
      </div>
      <p v-if="cuts.pdp !== ''" class="dt-ml-structure__cut">{{ cuts.pdp }}</p>
    </div>
    <div v-if="ranges.length > 0" class="dt-ml-structure__part">
      <p class="dt-ml-structure__part-title">训练取值区间</p>
      <BarList
        :items="ranges"
        mode="range"
        caption="这就是这个模型敢答的范围"
      />
      <p class="dt-ml-structure__summary">{{ summaries.ranges }}</p>
      <p v-if="cuts.ranges !== ''" class="dt-ml-structure__cut">
        {{ cuts.ranges }}
      </p>
    </div>
    <div v-if="!tree.isBlank" class="dt-ml-structure__part">
      <p class="dt-ml-structure__part-title">
        代表树（限深 {{ tree.depth }} 层，只是集成里的一棵）
      </p>
      <TreeOutline :branches="tree.roots" />
      <p class="dt-ml-structure__summary">{{ tree.summary }}</p>
      <p v-if="tree.cutNote !== ''" class="dt-ml-structure__cut">
        {{ tree.cutNote }}
      </p>
    </div>
    <p
      v-for="note in notes"
      :key="note.text"
      class="dt-ml-structure__note"
      :class="`dt-ml-structure__note--${note.level}`"
    >
      {{ note.text }}
    </p>
  </section>
</template>

<style scoped lang="scss">
.dt-ml-structure {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;

  &__part {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
  }

  // 辅图网格：列宽下限与主体图同档，摆得下两张 44rem 的图才排两列（规格 §3.2）。
  // ⚠ 下限写小了，viewBox 会把 7px 的刻度字按「渲染宽 ÷ 360」一起缩到读不动
  &__panels {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(44rem, 100%), 44rem));
    gap: 0.75rem;

    figure {
      margin: 0;
    }

    figcaption {
      margin-top: 0.25rem;
      color: var(--text-secondary);
      font-size: var(--ctl-hint-fs-sm);
    }
  }

  &__title {
    margin: 0;
    color: var(--text-primary);
    font-size: var(--ctl-hint-fs-md);
    font-weight: 600;
  }

  &__part-title {
    margin: 0;
    color: var(--text-secondary);
    font-size: var(--ctl-hint-fs-md);
  }

  &__summary,
  &__note {
    margin: 0;
    font-size: var(--ctl-hint-fs-sm);
  }

  &__summary {
    color: var(--text-primary);
  }

  &__note--hint {
    color: var(--text-secondary);
  }

  // 会让人读出错误结论的那一句整条摆出来，不收进小问号（规格 §11 的 R-24）
  &__note--alert {
    padding: 0.375rem 0.5rem;
    border: 1px solid var(--state-warning);
    border-radius: var(--radius-sm);
    background: rgba(var(--state-warning-rgb), 0.08);
    color: var(--text-primary);
  }

  &__cut {
    margin: 0;
    color: var(--state-warning);
    font-size: var(--ctl-hint-fs-sm);
  }
}
</style>
