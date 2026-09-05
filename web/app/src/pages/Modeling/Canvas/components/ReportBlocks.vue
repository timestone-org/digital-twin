<script setup lang="ts">
/**
 * @fileoverview 块的**唯一**派发点：按 `ZONE_ORDER` 分区，再按 `kind` 查画法。
 *
 * ⚠ 分区顺序由常量表定、不看数组顺序（规格 §2-P1）；查不到画法的块交给兜底件
 * 照实列出，不静默丢——丢掉的那一块与「这一步没算」在界面上分不出来。
 * ⚠ 对比图那一区再分主体位与辅图格（规格 §3.2）：主体图独占一行 44rem，辅图
 * 走 22rem 起的网格。挤在同一排时图的宽度由图注那行字的长短决定，改一个字版式
 * 就变一档。
 * ⚠ 公式不是块（规格 §6：它随算子代码走、不随运行走），但它摆在 ④ 区里，因此
 * 从这里一并派发——分开渲染的话，同一区会出现两个标题，或者公式落到区外。
 */
import { DtSkeleton } from '@dt/ui'
import type { Component } from 'vue'
import { computed } from 'vue'

import type { BlockKind, ReportBlock } from '../scripts/reportBlocks'
import { isBlockKind } from '../scripts/reportBlocks'
import type { FormulaSpec } from '../scripts/formulaCatalog'
import type { ReportZone } from '../scripts/zones'
import {
  CHART_ZONE,
  FORMULA_ZONE,
  ZONE_ORDER,
  ZONE_TITLES,
  groupByZone,
  withZone,
} from '../scripts/zones'

import AxisBlock from './AxisBlock.vue'
import BinsBlock from './BinsBlock.vue'
import BreakdownBlock from './BreakdownBlock.vue'
import CellsBlock from './CellsBlock.vue'
import ColumnsBlock from './ColumnsBlock.vue'
import FitsBlock from './FitsBlock.vue'
import FormulaBlock from './FormulaBlock.vue'
import RowsBlock from './RowsBlock.vue'
import StructureBlock from './StructureBlock.vue'
import TruncationNotice from './TruncationNotice.vue'
import UnknownBlock from './UnknownBlock.vue'

const props = withDefaults(
  defineProps<{
    blocks?: readonly ReportBlock[] | undefined
    /** 只摆这几区，缺省全要。摆放顺序仍由 `ZONE_ORDER` 定。 */
    zones?: readonly ReportZone[] | undefined
    /** 详情还没拉回来。⚠ 占位高度按区固定，回来之后不跳版。 */
    pending?: boolean | undefined
    /**
     * 被字节预算降档丢掉的那几块的标题。
     *
     * ⚠ 摆在块流的末尾而不是整屏顶上（规格 §2-P5 的第二档）：留痕里只有标题、
     * 没有分区，摆回它原来那一格是编的，但摆在块中间至少答得上「这里本来还有
     * 东西」。一个字都不说的话，「这一步本来就没有图」与「图被削掉了」在屏幕上
     * 长得一模一样。
     */
    dropped?: readonly string[] | undefined
    /** 降到最后一档时后端留下的那句说明；空串 = 没降到那一档。 */
    note?: string | undefined
    /** ④ 区的公式。骨架在前端、实参由调用方代好，这里只管摆。 */
    formulas?: readonly FormulaSpec[] | undefined
  }>(),
  {
    blocks: () => [],
    zones: () => ZONE_ORDER,
    pending: false,
    dropped: () => [],
    note: '',
    formulas: () => [],
  },
)

// 八种块的画法。⚠ 键集由 `Record<BlockKind, …>` 钉死：漏一种就过不了 typecheck，
// 与后端花名册漂了由 `tests/contract/modeling-blocks.contract.spec.ts` 逮
const BLOCK_VIEWS: Record<BlockKind, Component> = {
  rows: RowsBlock,
  columns: ColumnsBlock,
  cells: CellsBlock,
  fits: FitsBlock,
  bins: BinsBlock,
  axis: AxisBlock,
  breakdown: BreakdownBlock,
  structure: StructureBlock,
}

// 骨架的高度按区固定：三档高度是这三区实际内容的常见高度
const HOLDS: readonly { zone: ReportZone; height: string }[] = [
  { zone: 'step', height: '3rem' },
  { zone: 'stats', height: '6rem' },
  { zone: 'charts', height: '14rem' },
]

/** 对比图区分两档摆法；别的区一档摆完。 */
const LEAD_LANE = 'lead'
const AUX_LANE = 'aux'
const FLAT_LANE = 'flat'

interface Lane {
  key: string
  blocks: ReportBlock[]
}

const hasFormulas = computed(
  () => props.formulas.length > 0 && props.zones.includes(FORMULA_ZONE),
)

const groups = computed(() => {
  const found = groupByZone(props.blocks, props.zones)
  return hasFormulas.value ? withZone(found, FORMULA_ZONE) : found
})

const holds = computed(() =>
  HOLDS.filter((hold) => props.zones.includes(hold.zone)),
)

/**
 * 一个区里的块怎么分排。
 *
 * ⚠ 只有明写了 `is_primary: true` 的才进主体位：缺省是「没标」不是「是主体」，
 * 把没标的一律顶上去会让同一条降档梯子在不同算子上摆出不同的版面（§4.3）。
 * Args: zone, blocks。
 */
function lanesOf(zone: ReportZone, blocks: readonly ReportBlock[]): Lane[] {
  if (zone !== CHART_ZONE) return [{ key: FLAT_LANE, blocks: [...blocks] }]
  const lanes: Lane[] = [
    { key: LEAD_LANE, blocks: blocks.filter((one) => one.isPrimary === true) },
    { key: AUX_LANE, blocks: blocks.filter((one) => one.isPrimary !== true) },
  ]
  return lanes.filter((lane) => lane.blocks.length > 0)
}

function viewOf(kind: string): Component {
  return isBlockKind(kind) ? BLOCK_VIEWS[kind] : UnknownBlock
}

/** 块没有 id，用「区 + 种类 + 标题」当键：它在一次运行里是稳定的。 */
function keyOf(block: ReportBlock): string {
  return `${block.zone}:${block.kind}:${block.title}`
}

const hasTrace = computed(() => props.dropped.length > 0 || props.note !== '')

const hasBody = computed(() => groups.value.length > 0 || hasTrace.value)

/** 这一区要不要摆公式。⚠ 只有 ④ 区摆，别的区一条都不摆。 */
function formulasIn(zone: ReportZone): readonly FormulaSpec[] {
  return zone === FORMULA_ZONE && hasFormulas.value ? props.formulas : []
}
</script>

<template>
  <div v-if="props.pending" class="dt-ml-blocks" aria-busy="true">
    <div
      v-for="hold in holds"
      :key="hold.zone"
      class="dt-ml-blocks__hold"
      :style="{ height: hold.height }"
    >
      <DtSkeleton />
    </div>
  </div>
  <div v-else-if="hasBody" class="dt-ml-blocks">
    <section
      v-for="group in groups"
      :key="group.zone"
      class="dt-ml-blocks__zone"
      :data-zone="group.zone"
    >
      <h5 class="dt-ml-blocks__title">{{ ZONE_TITLES[group.zone] }}</h5>
      <div
        v-for="lane in lanesOf(group.zone, group.blocks)"
        :key="lane.key"
        class="dt-ml-blocks__lane"
        :data-lane="lane.key"
      >
        <component
          :is="viewOf(block.kind)"
          v-for="block in lane.blocks"
          :key="keyOf(block)"
          :block="block"
        />
      </div>
      <FormulaBlock
        v-for="spec in formulasIn(group.zone)"
        :key="spec.id"
        :spec="spec"
      />
    </section>
    <div v-if="hasTrace" class="dt-ml-blocks__gone">
      <p class="dt-ml-blocks__gone-title">这里本来还有几块，没能一起存下来</p>
      <TruncationNotice kind="budget" :dropped="props.dropped" />
      <p v-if="props.note !== ''" class="dt-ml-blocks__gone-note">
        {{ props.note }}
      </p>
    </div>
  </div>
</template>

<style scoped lang="scss">
.dt-ml-blocks {
  display: flex;
  flex-direction: column;
  gap: 1rem;

  &__hold :deep(.dt-skeleton) {
    height: 100%;
  }

  &__zone {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  &__lane {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  // 图的宽度归摆放它的这一区管，图元件自己不焊上限（规格 §3.2 的主体图档）
  &__lane[data-lane='lead'] {
    --dt-ml-chart-max: min(44rem, 100%);
  }

  // 辅图两列起排：70rem 的弹窗里正好两格，窄下来自己折成一列
  &__lane[data-lane='aux'] {
    --dt-ml-chart-max: 100%;

    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(22rem, 1fr));
    align-items: start;
  }

  &__title {
    margin: 0;
    color: var(--text-secondary);
    font-size: var(--ctl-hint-fs-md);
    font-weight: 600;
    letter-spacing: 0.02em;
  }

  // 留痕摆成一个「空出来的位置」：虚线框读起来就是这里缺了东西
  &__gone {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
    padding: 0.5rem;
    border: 1px dashed var(--border-subtle);
    border-radius: var(--radius-md);
  }

  &__gone-title {
    margin: 0;
    color: var(--text-secondary);
    font-size: var(--ctl-hint-fs-sm);
    font-weight: 600;
  }

  &__gone-note {
    margin: 0;
    color: var(--text-secondary);
    font-size: var(--ctl-hint-fs-sm);
  }
}
</style>
