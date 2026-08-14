<script setup lang="ts">
/**
 * @fileoverview 工具栏的排布簇：对齐六键、分布两键与整理。
 * 未就绪也渲染只是禁用——藏起来用户学不到「多选同层才能对齐」这条规则。
 */
import { DtButton } from '@dt/ui'
import { computed } from 'vue'

import type { AlignKind } from '@/features/dashboard/canvasAlign'

const props = defineProps<{
  alignReady: boolean
  distributeReady: boolean
}>()

const emit = defineEmits<{
  align: [kind: AlignKind]
  distribute: [axis: 'x' | 'y']
  tidy: []
}>()

const ALIGN_ACTIONS: readonly {
  kind: AlignKind
  icon: string
  label: string
}[] = [
  { kind: 'left', icon: 'align-left', label: '左对齐' },
  { kind: 'hcenter', icon: 'align-center-horizontal', label: '水平居中' },
  { kind: 'right', icon: 'align-right', label: '右对齐' },
  { kind: 'top', icon: 'align-top', label: '顶对齐' },
  { kind: 'vcenter', icon: 'align-center-vertical', label: '垂直居中' },
  { kind: 'bottom', icon: 'align-bottom', label: '底对齐' },
]

const DISTRIBUTE_ACTIONS: readonly {
  axis: 'x' | 'y'
  icon: string
  label: string
}[] = [
  { axis: 'x', icon: 'distribute-horizontal', label: '水平等间距' },
  { axis: 'y', icon: 'distribute-vertical', label: '垂直等间距' },
]

const alignHint = computed(() =>
  props.alignReady ? '' : '：需选中同一层级的 ≥2 个节点',
)

const distributeHint = computed(() =>
  props.distributeReady ? '' : '：需选中同一层级的 ≥3 个节点',
)
</script>

<template>
  <DtButton
    v-for="item in ALIGN_ACTIONS"
    :key="item.kind"
    size="sm"
    variant="ghost"
    intent="neutral"
    :icon="item.icon"
    :aria-label="item.label"
    :title="`${item.label}${alignHint}`"
    :data-test="`align-${item.kind}`"
    :disabled="!alignReady"
    @click="emit('align', item.kind)"
  />
  <span class="dt-arrange__divider" aria-hidden="true" />
  <DtButton
    v-for="item in DISTRIBUTE_ACTIONS"
    :key="item.axis"
    size="sm"
    variant="ghost"
    intent="neutral"
    :icon="item.icon"
    :aria-label="item.label"
    :title="`${item.label}${distributeHint}`"
    :data-test="`distribute-${item.axis}`"
    :disabled="!distributeReady"
    @click="emit('distribute', item.axis)"
  />
  <span class="dt-arrange__divider" aria-hidden="true" />
  <DtButton
    size="sm"
    variant="ghost"
    intent="neutral"
    icon="layout-grid"
    aria-label="整理布局"
    title="整理布局：消重叠并钳回边界"
    data-test="tidy"
    @click="emit('tidy')"
  />
</template>

<style scoped>
/* 同簇内的次级分隔，比组边界淡一档 */
.dt-arrange__divider {
  align-self: stretch;
  width: 1px;
  margin: 4px 2px;
  background: var(--border-subtle);
  opacity: 0.6;
}
</style>
