<script setup lang="ts">
/**
 * @fileoverview 多选之后的批量摆位：六档对齐与两档等间距。收整份配置，产出整份新配置
 * 往上抛，本组件一处都不碰文档态与撤销栈。
 *
 * ⚠ 算术全在 `nodeOps` / `markOps` 那两支里，本层一个坐标都不算：对齐的基准是选中集
 * **自己的外接盒**（不是画布），在这里另写一份的表现是「按钮对出来的位置与方向键挪出来
 * 的对不齐」，而两处单看都对。
 * ⚠ 连线那一类整个不摆：连线的两端认的是节点与端口，挪线本身没有意义——摆出一排
 * 按不动的键，用户只会以为是坏了。
 * ⚠ 等间距要三个起步：两只之间没有「中间」可分，两只时那两枚键禁用而不是藏起来，
 * 否则「为什么少了两个键」得靠猜。
 */
import type { Twin2dConfig, Twin2dNodeStyle } from '@dt/twin2d'
import { DtButton } from '@dt/ui'
import { computed } from 'vue'

import type { Twin2dPick } from '../scripts/editorSelection'
import { alignMarks, distributeMarks } from '../scripts/markOps'
import { alignNodes, distributeNodes } from '../scripts/nodeOps'
import type { Twin2dAlignEdge, Twin2dDistributeAxis } from '../scripts/nodeOps'
import { twin2dMergedNodeStyles } from '../scripts/styleOps'

/** 摆得动的两类；连线不在其中。 */
type ArrangeKind = 'nodes' | 'marks'

const props = defineProps<{
  /** 整份配置；改动整份产出往上抛。 */
  config: Twin2dConfig
  /** 画布上选中的那一批；null = 一个都没选。 */
  pick: Twin2dPick | null
}>()

const emit = defineEmits<{
  /** 一次动作改出来的整份新配置，落一帧撤销。 */
  change: [config: Twin2dConfig]
}>()

/** 等间距最少要几个。 */
const DISTRIBUTE_MIN = 3

const KIND_LABELS: Readonly<Record<ArrangeKind, string>> = {
  nodes: '节点',
  marks: '标注',
}

const ALIGN_ACTIONS: readonly { edge: Twin2dAlignEdge; label: string }[] = [
  { edge: 'left', label: '左对齐' },
  { edge: 'hcenter', label: '水平居中' },
  { edge: 'right', label: '右对齐' },
  { edge: 'top', label: '顶对齐' },
  { edge: 'vcenter', label: '垂直居中' },
  { edge: 'bottom', label: '底对齐' },
]

const DISTRIBUTE_ACTIONS: readonly {
  axis: Twin2dDistributeAxis
  label: string
}[] = [
  { axis: 'x', label: '水平等间距' },
  { axis: 'y', label: '垂直等间距' },
]

/** 这一批摆不摆得动；摆不动时整块不画。 */
const target = computed<{ kind: ArrangeKind; ids: readonly string[] } | null>(
  () => {
    const at = props.pick
    if (at === null || at.ids.length < 2) return null
    if (at.kind !== 'nodes' && at.kind !== 'marks') return null
    return { kind: at.kind, ids: at.ids }
  },
)

const countLabel = computed(() => {
  const at = target.value
  return at === null ? '' : `已选 ${at.ids.length} 个${KIND_LABELS[at.kind]}`
})

const canDistribute = computed(
  () => (target.value?.ids.length ?? 0) >= DISTRIBUTE_MIN,
)

/**
 * 节点样式查表；口径与调色板、样式库抽屉同一支（`twin2dMergedNodeStyles`）。
 * ⚠ 必须并上预置库：只喂文档里那几份的话，用预置样式的节点取不到尺寸，于是它的盒
 * 算不出来、这一批对齐时它原地不动，而界面上什么都不说。
 */
const nodeStyles = computed<ReadonlyMap<string, Twin2dNodeStyle>>(
  () =>
    new Map(
      twin2dMergedNodeStyles(props.config.styles).map((style) => [
        style.id,
        style,
      ]),
    ),
)

/**
 * 抛一份新配置；与原样返回的那一份同引用时什么都不做。
 * ⚠ 按引用判而不是在这里重算一遍判据：两支 ops 拦得住的那几档（不足两个、id 落不到
 * 实处）已经由它们原样返回入参，在这里再判一遍迟早与它们漂开，而漂开的表现是撤销栈里
 * 多出一格什么都没改的空步。
 * @param next 算出来的整份配置
 */
function commit(next: Twin2dConfig): void {
  if (next !== props.config) emit('change', next)
}

/**
 * 对到同一条边上。
 * @param edge 对齐到哪一边
 */
function align(edge: Twin2dAlignEdge): void {
  const at = target.value
  if (at === null) return
  commit(
    at.kind === 'nodes'
      ? alignNodes(props.config, at.ids, nodeStyles.value, edge)
      : alignMarks(props.config, at.ids, edge),
  )
}

/**
 * 沿一条轴摆成等间距。
 * @param axis 沿哪条轴
 */
function distribute(axis: Twin2dDistributeAxis): void {
  const at = target.value
  if (at === null) return
  commit(
    at.kind === 'nodes'
      ? distributeNodes(props.config, at.ids, nodeStyles.value, axis)
      : distributeMarks(props.config, at.ids, axis),
  )
}
</script>

<template>
  <section v-if="target !== null" data-test="arrange-panel">
    <p class="mb-2 text-xs text-text-primary" data-test="arrange-count">
      {{ countLabel }}
    </p>

    <h3 class="mb-1 text-2xs tracking-wide text-text-disabled">对齐</h3>
    <div class="mb-2 grid grid-cols-3 gap-1">
      <DtButton
        v-for="item in ALIGN_ACTIONS"
        :key="item.edge"
        size="sm"
        variant="outline"
        intent="neutral"
        block
        :aria-label="item.label"
        :title="item.label"
        :data-test="`arrange-align-${item.edge}`"
        @click="align(item.edge)"
      >
        {{ item.label }}
      </DtButton>
    </div>

    <h3 class="mb-1 text-2xs tracking-wide text-text-disabled">分布</h3>
    <div class="grid grid-cols-2 gap-1">
      <DtButton
        v-for="item in DISTRIBUTE_ACTIONS"
        :key="item.axis"
        size="sm"
        variant="outline"
        intent="neutral"
        block
        :aria-label="item.label"
        :title="canDistribute ? item.label : `${item.label}：至少要选三个`"
        :disabled="!canDistribute"
        :data-test="`arrange-distribute-${item.axis}`"
        @click="distribute(item.axis)"
      >
        {{ item.label }}
      </DtButton>
    </div>
  </section>
</template>
