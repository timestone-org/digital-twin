<script setup lang="ts">
/**
 * @fileoverview 块的**唯一**派发点：按 `ZONE_ORDER` 分区，再按 `kind` 查画法。
 *
 * ⚠ 分区顺序由常量表定、不看数组顺序（规格 §2-P1）；查不到画法的块交给兜底件
 * 照实列出，不静默丢——丢掉的那一块与「这一步没算」在界面上分不出来。
 */
import { DtSkeleton } from '@dt/ui'
import type { Component } from 'vue'
import { computed } from 'vue'

import type { BlockKind, ReportBlock } from '../scripts/reportBlocks'
import { isBlockKind } from '../scripts/reportBlocks'
import type { ReportZone } from '../scripts/zones'
import { ZONE_ORDER, ZONE_TITLES, groupByZone } from '../scripts/zones'

import UnknownBlock from './UnknownBlock.vue'

const props = withDefaults(
  defineProps<{
    blocks?: readonly ReportBlock[] | undefined
    /** 只摆这几区，缺省全要。摆放顺序仍由 `ZONE_ORDER` 定。 */
    zones?: readonly ReportZone[] | undefined
    /** 详情还没拉回来。⚠ 占位高度按区固定，回来之后不跳版。 */
    pending?: boolean | undefined
  }>(),
  { blocks: () => [], zones: () => ZONE_ORDER, pending: false },
)

// 八种块的画法。⚠ 键集由 `Record<BlockKind, …>` 钉死：漏一种就过不了 typecheck，
// 与后端花名册漂了由 `tests/contract/modeling-blocks.contract.spec.ts` 逮
const BLOCK_VIEWS: Record<BlockKind, Component> = {
  rows: UnknownBlock,
  columns: UnknownBlock,
  cells: UnknownBlock,
  fits: UnknownBlock,
  bins: UnknownBlock,
  axis: UnknownBlock,
  breakdown: UnknownBlock,
  structure: UnknownBlock,
}

// 骨架的高度按区固定：三档高度是这三区实际内容的常见高度
const HOLDS: readonly { zone: ReportZone; height: string }[] = [
  { zone: 'step', height: '3rem' },
  { zone: 'stats', height: '6rem' },
  { zone: 'charts', height: '14rem' },
]

const groups = computed(() => groupByZone(props.blocks, props.zones))

const holds = computed(() =>
  HOLDS.filter((hold) => props.zones.includes(hold.zone)),
)

function viewOf(kind: string): Component {
  return isBlockKind(kind) ? BLOCK_VIEWS[kind] : UnknownBlock
}

/** 块没有 id，用「区 + 种类 + 标题」当键：它在一次运行里是稳定的。 */
function keyOf(block: ReportBlock): string {
  return `${block.zone}:${block.kind}:${block.title}`
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
  <div v-else-if="groups.length > 0" class="dt-ml-blocks">
    <section
      v-for="group in groups"
      :key="group.zone"
      class="dt-ml-blocks__zone"
      :data-zone="group.zone"
    >
      <h5 class="dt-ml-blocks__title">{{ ZONE_TITLES[group.zone] }}</h5>
      <component
        :is="viewOf(block.kind)"
        v-for="block in group.blocks"
        :key="keyOf(block)"
        :block="block"
      />
    </section>
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

  // 图的宽度归摆放它的这一区管，图元件自己不焊上限（规格 §3.2 的主体图档）
  &__zone[data-zone='charts'] {
    --dt-ml-chart-max: min(44rem, 100%);
  }

  &__title {
    margin: 0;
    color: var(--text-secondary);
    font-size: var(--ctl-hint-fs-md);
    font-weight: 600;
    letter-spacing: 0.02em;
  }
}
</style>
