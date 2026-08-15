<script setup lang="ts">
/**
 * @fileoverview 把分隔条接到宽度控制器上的一层薄适配。
 * ⚠ 存在的理由是「side 只写一次」：分隔条的宽度、取值域与三个动作都要带同一个
 * side，在调用处逐个手写时，把某一个写成另一侧既不报错也看不出来——
 * 表现是拖左边的条改的是右边的栏。
 */
import PaneSplitter from './PaneSplitter.vue'

import type { EditorPanes } from '../useEditorPanes'
import type { PaneSide } from '../paneWidths'

const props = defineProps<{
  side: PaneSide
  label: string
  panes: EditorPanes
}>()

function grab(event: PointerEvent): void {
  props.panes.startDrag(props.side, event)
}

function nudge(delta: number): void {
  props.panes.nudge(props.side, delta)
}

function reset(): void {
  props.panes.reset(props.side)
}
</script>

<template>
  <PaneSplitter
    :label="label"
    :width="side === 'left' ? panes.left.value : panes.right.value"
    :limits="panes.limitsOf(side)"
    @grab="grab"
    @nudge="nudge"
    @reset="reset"
  />
</template>
