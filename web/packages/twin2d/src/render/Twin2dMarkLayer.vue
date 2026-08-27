<script setup lang="ts">
/**
 * @fileoverview 标注层：一档 `zOrder` 的标注画进一层 `<svg>`，形状逐条交给
 * `Twin2dMarkShape`。舞台把它挂两次——`below` 那层在连线之下、`above` 那层在节点之上，
 * 与编辑器的标注层逐层对齐。口径见 docs/MODULE_TWIN_2D_DESIGN.md §7.10（#74）。
 *
 * ⚠ 本层不吃指针（`twin2d.scss` 的 `.t2-marks`）：吃了的话铺满整块画布的图框会把底下
 * 的节点全部挡掉，而界面上看不出任何异常。
 */
import { computed } from 'vue'

import { posDim } from '../sanitize'
import Twin2dMarkShape from './Twin2dMarkShape.vue'
import type { Twin2dMark } from '../types'

/** viewBox 的除零护栏：`0 0 0 0` 会让整层什么都不画 */
const MIN_CANVAS = 1

const props = defineProps<{
  /** 这一层要画的标注，文档序即绘制序。 */
  marks: readonly Twin2dMark[]
  /** 画布宽（设计像素）。 */
  width: number
  /** 画布高（设计像素）。 */
  height: number
}>()

const viewBox = computed(() => {
  const w = posDim(props.width, MIN_CANVAS)
  const h = posDim(props.height, MIN_CANVAS)
  return `0 0 ${w} ${h}`
})
</script>

<template>
  <svg
    class="t2-marks"
    :viewBox="viewBox"
    :width="width"
    :height="height"
    aria-hidden="true"
  >
    <Twin2dMarkShape v-for="mark in marks" :key="mark.id" :mark="mark" />
  </svg>
</template>
