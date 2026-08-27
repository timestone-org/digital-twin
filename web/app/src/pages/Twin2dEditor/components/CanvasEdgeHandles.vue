<script setup lang="ts">
/**
 * @fileoverview 选中那条连线上的把手：每个拐点一枚、两端各一枚。拖拐点走网格吸附，
 * 拖端点落到节点上时吸最近的端口或周长。
 *
 * ⚠ 一手势一步撤销：拖动期间只往上抛 `preview`（纯变更，谁都不写文档），收场那一下
 * 才抛一次 `change`。逐帧 commit 不报错，只是撤销键从此按不回上一步。
 * ⚠ 拖到一半本组件被卸载（切了选中）也要补上那一次 `change`：不补的话改动既没进
 * 撤销栈也没落库，而界面上什么都不会说。
 * ⚠ 没挪过的那一手（`moved` 仍是 false）一律不落 commit：双击删拐点会先走两轮
 * 按下松手，逐轮都 commit 的话删一个拐点会在撤销栈里留下两格空动作。
 */
import type {
  Pt,
  Twin2dCanvas,
  Twin2dEdge,
  Twin2dEdgeStyle,
  Twin2dNode,
  Twin2dNodeStyle,
} from '@dt/twin2d'
import { computed, onBeforeUnmount, shallowRef } from 'vue'

import { snapAtScale, snapThresholdOf } from '../scripts/snapping'
import {
  TWIN_2D_DROP_SNAP_PX,
  dropEndpoint,
  edgePolyline,
  moveWaypoint,
  removeWaypoint,
} from '../scripts/waypointOps'
import type { Twin2dSnapOptions } from '../scripts/snapping'
import type {
  Twin2dGestureEnd,
  Twin2dGestureFrame,
  Twin2dGestureKind,
  Twin2dGestureSpec,
} from '../scripts/useCanvasPointer'
import { canvasViewBox, screenToDesignPx } from '../scripts/viewportOps'

/** 把手半径（屏幕像素） */
const HANDLE_PX = 5
/** 一条线画得出把手的最少点数 */
const MIN_POINTS = 2

/** 两端各自的键，与 `Twin2dEdge` 上的字段名同名。 */
type EndKey = 'from' | 'to'

/** 一枚把手：`key` 同时是 `v-for` 的键。 */
interface Handle {
  key: string
  at: Pt
}

const props = defineProps<{
  canvas: Twin2dCanvas
  /** 选中的那条连线。 */
  edge: Twin2dEdge
  nodes: readonly Twin2dNode[]
  nodeStyles: readonly Twin2dNodeStyle[]
  edgeStyles: readonly Twin2dEdgeStyle[]
  snap: Twin2dSnapOptions
  /** 当前视口倍率：把手按屏幕像素恒定大小。 */
  scale: number
  /** 起一次手势；画布的指针总线出这两支，本组件不另装监听。 */
  startGesture: (spec: Twin2dGestureSpec) => boolean
  cancelGesture: () => void
}>()

const emit = defineEmits<{
  /** 这一帧的草稿边；null = 没有草稿了，照文档画。 */
  preview: [edge: Twin2dEdge | null]
  /** 一手势一次：把改完的整条边交给调用方落一次 commit。 */
  change: [edge: Twin2dEdge]
}>()

const draft = shallowRef<Twin2dEdge | null>(null)

/** 正在飞的那一手是不是本组件起的；卸载时只收自己的场，别掐别人的拖动。 */
let live = false

/** 拖动期间照草稿画，没在拖就照文档画。 */
const shown = computed<Twin2dEdge>(() => draft.value ?? props.edge)

const viewBox = computed(() => canvasViewBox(props.canvas))

const radius = computed(() => screenToDesignPx(HANDLE_PX, props.scale))

/** 吸端口的半径：屏幕上恒定十来个像素，缩放时跟着换算。 */
const dropThreshold = computed(() =>
  snapThresholdOf(props.scale, TWIN_2D_DROP_SNAP_PX),
)

/**
 * 两端把手落在真实折线的头尾上——不自己再算一遍两端，就不会浮在离线几像素的地方。
 */
const ends = computed<readonly { key: EndKey; at: Pt }[]>(() => {
  const points = edgePolyline(
    shown.value,
    props.nodes,
    props.nodeStyles,
    props.edgeStyles,
  )
  const first = points[0]
  const last = points[points.length - 1]
  if (points.length < MIN_POINTS || first === undefined || last === undefined) {
    return []
  }
  return [
    { key: 'from', at: first },
    { key: 'to', at: last },
  ]
})

/** 拐点把手直接落在拐点上：它们本来就是设计坐标。 */
const bends = computed<readonly Handle[]>(() =>
  shown.value.waypoints.map((point, order) => ({
    key: `bend-${order}`,
    at: point,
  })),
)

/** ⚠ 按住 Alt 的那一帧不吸附：留一手「至少吸网格」会让微调永远差一两个像素。 */
function snapOf(frame: Twin2dGestureFrame): Twin2dSnapOptions {
  return snapAtScale(props.snap, props.scale, frame.alt)
}

/** 丢掉草稿；已经没有草稿时是一次空动作。 */
function clearDraft(): void {
  if (draft.value === null) return
  draft.value = null
  emit('preview', null)
}

/** 落一次 commit：这一手势改出来的整条边交上去，草稿随即清掉。 */
function settle(): void {
  const next = draft.value
  clearDraft()
  if (next !== null) emit('change', next)
}

/**
 * 收场：撤掉的那一档丢草稿，另两档（松手、被顶掉）各落一次 commit。
 * @param end 怎么收的场
 */
function finish(end: Twin2dGestureEnd): void {
  live = false
  if (end === 'cancelled') clearDraft()
  else settle()
}

/**
 * 写一帧草稿；没挪过的那一帧不写，于是「点一下」不会留下一格撤销。
 * @param next 这一帧改出来的边；null = 这一帧不算改动
 */
function drawDraft(next: Twin2dEdge | null): void {
  draft.value = next
  emit('preview', next)
}

/**
 * 起一次把手手势：每一帧按 `of` 算出草稿，收场那一帧也算进去再落一次 commit。
 * ⚠ 收场那一帧不能省：浏览器不保证松手前一定还有一次 `pointermove`，只认移动帧的话
 * 落库的是倒数第二个位置——差得不多，所以没人会怀疑是这里错了。
 * @param kind 这一手属于哪一类
 * @param event 起手的那一下
 * @param of 一帧 → 这一帧改出来的边；null = 这一帧不算改动
 */
function runGesture(
  kind: Twin2dGestureKind,
  event: PointerEvent,
  of: (frame: Twin2dGestureFrame) => Twin2dEdge | null,
): void {
  // ⚠ 这一按不许再冒到画布壳上：那边把落到自己身上的按下当成「点了空白」，
  // 不拦的表现是抓把手的同时选中被清掉
  event.stopPropagation()
  live = props.startGesture({
    kind,
    event,
    onMove: (frame) => {
      if (frame.moved) drawDraft(of(frame))
    },
    onEnd: (frame, end) => {
      if (end !== 'cancelled' && frame.moved) drawDraft(of(frame))
      finish(end)
    },
  })
}

/**
 * 拖一个拐点。
 * ⚠ 跟的是这一手势的**位移**而不是指针落点：拿落点当新拐点的话，抓在把手边上那几个
 * 像素会在起手瞬间跳到指针底下，放大之后一眼就看得出来。
 * @param index 第几个拐点
 * @param event 起手的那一下
 */
function grabBend(index: number, event: PointerEvent): void {
  const from = props.edge.waypoints[index]
  if (from === undefined) return
  runGesture('bend', event, (frame) => ({
    ...props.edge,
    waypoints: moveWaypoint(
      props.edge.waypoints,
      index,
      { x: from.x + frame.dx, y: from.y + frame.dy },
      snapOf(frame),
    ),
  }))
}

/**
 * 拖一端。落在空白处时这一帧不算改动：文档契约里没有「不挂节点的端点」那一档，
 * 就地造一个的表现是这条线在下次读盘时整条静默消失。
 * @param key 拖的是哪一端
 * @param event 起手的那一下
 */
function grabEnd(key: EndKey, event: PointerEvent): void {
  runGesture('endpoint', event, (frame) => {
    const drop = dropEndpoint(
      props.nodes,
      props.nodeStyles,
      frame.to,
      dropThreshold.value,
    )
    if (drop === null) return null
    const edge = props.edge
    return key === 'from' ? { ...edge, from: drop } : { ...edge, to: drop }
  })
}

/**
 * 双击一个拐点把手就删掉它：一次性动作，直接落一次 commit。
 * @param index 第几个拐点
 */
function dropBend(index: number): void {
  emit('change', {
    ...props.edge,
    waypoints: removeWaypoint(props.edge.waypoints, index),
  })
}

// ⚠ 拖到一半被卸载：先把这一手落一次 commit，再让总线收场（那一次撤回时草稿已空，
// 不会再落第二次）
onBeforeUnmount(() => {
  if (!live) return
  settle()
  props.cancelGesture()
})
</script>

<template>
  <svg
    class="dt-edge-handles"
    :viewBox="viewBox"
    :width="canvas.width"
    :height="canvas.height"
    data-test="edge-handles"
  >
    <rect
      v-for="end in ends"
      :key="end.key"
      class="dt-edge-handles__end"
      :x="end.at.x - radius"
      :y="end.at.y - radius"
      :width="radius * 2"
      :height="radius * 2"
      data-test="edge-end-handle"
      :data-id="end.key"
      @pointerdown="grabEnd(end.key, $event)"
    />
    <circle
      v-for="(bend, order) in bends"
      :key="bend.key"
      class="dt-edge-handles__bend"
      :cx="bend.at.x"
      :cy="bend.at.y"
      :r="radius"
      data-test="edge-bend-handle"
      :data-id="bend.key"
      @pointerdown="grabBend(order, $event)"
      @dblclick="dropBend(order)"
    />
  </svg>
</template>

<style scoped lang="scss">
.dt-edge-handles {
  position: absolute;
  inset: 0;
  overflow: visible;
  // 整层只在把手上吃指针，别的地方一律让给底下的连线与节点
  pointer-events: none;
}

.dt-edge-handles__end,
.dt-edge-handles__bend {
  fill: var(--surface-panel);
  stroke: var(--accent-primary);
  // ⚠ 线宽不跟着缩放走：缩小时一像素的描边会细到看不见，而把手本身还在
  vector-effect: non-scaling-stroke;
  stroke-width: 1.5;
  pointer-events: auto;
  cursor: move;
}

.dt-edge-handles__end {
  cursor: crosshair;
}
</style>
