<script setup lang="ts">
/**
 * @fileoverview 选中那一条标注的把手：有框的两档（rect / text）给八向缩放手柄，
 * 辅助线给两个端点手柄。只画把手并把起手的 `pointerdown` 抛上去，算术在标注层里。
 *
 * ⚠ 手柄的边长按倍率反算，屏幕上恒定 9 px：跟着舞台缩放的话，缩到四分之一时手柄
 * 只剩两三个像素，谁都点不中。
 * ⚠ 起手要拦下冒泡，否则画布背景会同时起一次框选，表现是「一拖手柄就把整片框选上」。
 */
import type { Pt, Twin2dMark } from '@dt/twin2d'
import { computed } from 'vue'

import { screenToDesignPx } from '../scripts/viewportOps'

/** 手柄在屏幕上的边长。 */
const HANDLE_PX = 9
/** 端点手柄的屏幕半径。 */
const ENDPOINT_PX = 5

/** 八个方向，从左上顺时针；`0` = 这一轴不动。 */
const DIRECTIONS: readonly Pt[] = [
  { x: -1, y: -1 },
  { x: 0, y: -1 },
  { x: 1, y: -1 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
  { x: -1, y: 1 },
  { x: -1, y: 0 },
]

/** 一枚缩放手柄画在哪儿。 */
interface BoxHandle {
  id: string
  dir: Pt
  x: number
  y: number
  cursor: string
}

/** 一枚端点手柄画在哪儿；`index` 0 = 起点、1 = 终点。 */
interface EndpointHandle {
  index: number
  x: number
  y: number
}

const props = defineProps<{
  /** 选中的那一条标注。 */
  mark: Twin2dMark
  /** 当前视口倍率；手柄按它反算成恒定的屏幕尺寸。 */
  scale: number
}>()

const emit = defineEmits<{
  /** 起手拖某个方向的缩放手柄；`dir` 的两轴各取 −1 / 0 / 1。 */
  resize: [dir: Pt, event: PointerEvent]
  /** 起手拖辅助线的端点。 */
  endpoint: [index: number, event: PointerEvent]
}>()

const handleSide = computed(() => screenToDesignPx(HANDLE_PX, props.scale))

const endpointRadius = computed(() =>
  screenToDesignPx(ENDPOINT_PX, props.scale),
)

const isLine = computed(() => props.mark.kind === 'line')

/**
 * 手柄的鼠标指针：角上两条对角线，边上两条正交。
 * @param dir 方向
 */
function cursorOf(dir: Pt): string {
  if (dir.x === 0) return 'ns-resize'
  if (dir.y === 0) return 'ew-resize'
  return dir.x === dir.y ? 'nwse-resize' : 'nesw-resize'
}

/**
 * 一枚手柄的左上角：方向 −1 贴起边、0 贴中线、1 贴末边，再往回半个手柄居中。
 * @param start 这一轴上的起边
 * @param size 这一轴上的尺寸
 * @param dir 这一轴的方向
 */
function handleAt(start: number, size: number, dir: number): number {
  return start + ((dir + 1) / 2) * size - handleSide.value / 2
}

const boxHandles = computed<readonly BoxHandle[]>(() => {
  if (isLine.value) return []
  const mark = props.mark
  return DIRECTIONS.map((dir) => ({
    id: `${dir.x},${dir.y}`,
    dir,
    x: handleAt(mark.x, mark.w, dir.x),
    y: handleAt(mark.y, mark.h, dir.y),
    cursor: cursorOf(dir),
  }))
})

const endpoints = computed<readonly EndpointHandle[]>(() => {
  const mark = props.mark
  if (!isLine.value) return []
  return [
    { index: 0, x: mark.x, y: mark.y },
    { index: 1, x: mark.x2, y: mark.y2 },
  ]
})

/**
 * 起手一次缩放。
 * @param dir 方向
 * @param event 起手事件
 */
function grabResize(dir: Pt, event: PointerEvent): void {
  event.stopPropagation()
  event.preventDefault()
  emit('resize', dir, event)
}

/**
 * 起手拖一个端点。
 * @param index 0 = 起点、1 = 终点
 * @param event 起手事件
 */
function grabEndpoint(index: number, event: PointerEvent): void {
  event.stopPropagation()
  event.preventDefault()
  emit('endpoint', index, event)
}
</script>

<template>
  <g class="t2m-handles" data-test="mark-handles" :data-id="mark.id">
    <line
      v-if="isLine"
      class="t2m-outline"
      data-test="mark-outline"
      :x1="mark.x"
      :y1="mark.y"
      :x2="mark.x2"
      :y2="mark.y2"
      vector-effect="non-scaling-stroke"
    />
    <rect
      v-else
      class="t2m-outline"
      data-test="mark-outline"
      :x="mark.x"
      :y="mark.y"
      :width="mark.w"
      :height="mark.h"
      vector-effect="non-scaling-stroke"
    />
    <circle
      v-for="point in endpoints"
      :key="point.index"
      class="t2m-handle"
      data-test="mark-endpoint"
      :data-index="point.index"
      :cx="point.x"
      :cy="point.y"
      :r="endpointRadius"
      @pointerdown="grabEndpoint(point.index, $event)"
    />
    <rect
      v-for="handle in boxHandles"
      :key="handle.id"
      class="t2m-handle"
      data-test="mark-handle"
      :data-dir="handle.id"
      :x="handle.x"
      :y="handle.y"
      :width="handleSide"
      :height="handleSide"
      :style="{ cursor: handle.cursor }"
      @pointerdown="grabResize(handle.dir, $event)"
    />
  </g>
</template>

<style scoped>
.t2m-outline {
  fill: none;
  stroke: var(--accent-primary);
  stroke-width: 1;
  stroke-dasharray: 4 3;
  pointer-events: none;
}

.t2m-handle {
  fill: var(--surface-base);
  stroke: var(--accent-primary);
  stroke-width: 1;
  vector-effect: non-scaling-stroke;
  pointer-events: auto;
  cursor: move;
}
</style>
