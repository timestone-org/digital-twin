<script setup lang="ts">
/**
 * @fileoverview 从一个端口拉出来的连线预览：一条跟着指针走的虚线，松手落到别的节点
 * 上才抛一条新连线的两端。
 *
 * ⚠ 预览期间一个字都不往文档里写：拉到一半松在空白处的那一手要能整个丢掉，而写进去
 * 再删就等于往撤销栈里塞两格空动作。
 * ⚠ 预览画的是直线，落定之后才按走线档重画：预览期间跟着走线档跑，指针每越过一次
 * 拐点整条线就跳一下，看着像画布在抖。
 */
import { portWorldPos } from '@dt/twin2d'
import type {
  Pt,
  Twin2dCanvas,
  Twin2dEndpoint,
  Twin2dNode,
  Twin2dNodeStyle,
} from '@dt/twin2d'
import { computed, onBeforeUnmount, shallowRef, watch } from 'vue'

import { snapThresholdOf } from '../scripts/snapping'
import {
  TWIN_2D_DROP_SNAP_PX,
  dropEndpoint,
  resolveEdgeEnd,
} from '../scripts/waypointOps'
import type {
  Twin2dGestureEnd,
  Twin2dGestureSpec,
} from '../scripts/useCanvasPointer'
import { canvasViewBox, screenToDesignPx } from '../scripts/viewportOps'

/** 落点圆点的半径（屏幕像素） */
const DOT_PX = 4

/** 一个节点实例与它的样式。 */
interface NodePair {
  node: Twin2dNode
  style: Twin2dNodeStyle
}

const props = defineProps<{
  canvas: Twin2dCanvas
  /** 从哪个端口起手；换一个 `event` 对象即起一次新手势，null = 没在拉线。 */
  source: { nodeId: string; portId: string; event: PointerEvent } | null
  nodes: readonly Twin2dNode[]
  nodeStyles: readonly Twin2dNodeStyle[]
  /** 当前视口倍率。 */
  scale: number
  /** 起一次手势；画布的指针总线出这两支，本组件不另装监听。 */
  startGesture: (spec: Twin2dGestureSpec) => boolean
  cancelGesture: () => void
}>()

const emit = defineEmits<{
  /** 松手落到一个节点上：这条新连线的两端，造边与落库归调用方。 */
  connect: [from: Twin2dEndpoint, to: Twin2dEndpoint]
  /** 这一手收场了（连上或丢弃都发），调用方借它把 `source` 清空。 */
  done: []
}>()

/** 起手那一端；手势期间捕获着，不再回头读 `source`。 */
const from = shallowRef<Twin2dEndpoint | null>(null)
/** 起手端口在画布上的落点。 */
const origin = shallowRef<Pt | null>(null)
/** 指针当前落点（设计坐标）。 */
const tip = shallowRef<Pt | null>(null)
/** 当前会连到哪；null = 落在空白处，松手即丢弃。 */
const target = shallowRef<Twin2dEndpoint | null>(null)

/** 正在飞的那一手是不是本组件起的。 */
let live = false
/** 已经按哪一个 pointerdown 起过手；同一个不再起第二次。 */
let started: PointerEvent | null = null

const viewBox = computed(() => canvasViewBox(props.canvas))

const dotRadius = computed(() => screenToDesignPx(DOT_PX, props.scale))

const dropThreshold = computed(() =>
  snapThresholdOf(props.scale, TWIN_2D_DROP_SNAP_PX),
)

/**
 * 节点与样式配对；任一寻不到时 null。
 * @param nodeId 节点 id
 */
function pairOf(nodeId: string): NodePair | null {
  const node = props.nodes.find((item) => item.id === nodeId)
  if (node === undefined) return null
  const style = props.nodeStyles.find((item) => item.id === node.styleId)
  return style === undefined ? null : { node, style }
}

/**
 * 起手端口在画布上的落点；端口寻不到时 null。
 * ⚠ 走 `resolveEdgeEnd` 而不是直接拿端口坐标：带引脚符号的端口，线是从引脚**外端**
 * 起画的，拿端口坐标画预览会让虚线从引脚中段横穿出去，而落定之后又跳回外端。
 * @param pair 节点与它的样式
 * @param portId 端口 id
 */
function portPoint(pair: NodePair, portId: string): Pt | null {
  if (portWorldPos(pair.node, pair.style, portId) === null) return null
  const end: Twin2dEndpoint = { nodeId: pair.node.id, portId, t: null }
  // 端口解析得出，所以第三级的「朝向对方中心」用不上，给节点自己的原点即可
  const toward: Pt = { x: pair.node.x, y: pair.node.y }
  return resolveEdgeEnd(end, pair.node, pair.style, toward).point
}

/** 清掉本地状态；不发任何事件。 */
function clearGesture(): void {
  from.value = null
  origin.value = null
  tip.value = null
  target.value = null
}

/**
 * 收场：撤掉的那一档与落在空白处的那一档都整个丢弃，其余落一条新连线。
 * ⚠ 头一行的短路不能省：卸载补收场之后总线还会再回调一次，少了它 `done` 会发两次。
 * @param end 怎么收的场
 */
function finish(end: Twin2dGestureEnd): void {
  if (!live) return
  live = false
  const start = from.value
  const drop = target.value
  clearGesture()
  if (end !== 'cancelled' && start !== null && drop !== null) {
    emit('connect', start, drop)
  }
  emit('done')
}

/**
 * 每一帧：记下落点，并算出松手会连到哪。
 * @param at 这一帧的落点（设计坐标）
 */
function track(at: Pt): void {
  tip.value = at
  const drop = dropEndpoint(
    props.nodes,
    props.nodeStyles,
    at,
    dropThreshold.value,
  )
  // ⚠ 不许落回起手的那个节点：两端会解析到同一只盒上，画出来是一个点
  const own = from.value?.nodeId ?? ''
  target.value = drop === null || drop.nodeId === own ? null : drop
}

/**
 * 起一次拉线。
 * @param nodeId 起手端口所在的节点
 * @param portId 起手端口
 * @param event 起手的那一下 pointerdown
 */
function begin(nodeId: string, portId: string, event: PointerEvent): void {
  const pair = pairOf(nodeId)
  const at = pair === null ? null : portPoint(pair, portId)
  if (at === null) {
    emit('done')
    return
  }
  from.value = { nodeId, portId, t: null }
  origin.value = at
  tip.value = at
  target.value = null
  live = props.startGesture({
    kind: 'link',
    event,
    onMove: (frame) => track(frame.to),
    onEnd: (_frame, end) => finish(end),
  })
  // 舞台还没挂上时手势起不来，这一手当没发生过
  if (!live) {
    clearGesture()
    emit('done')
  }
}

/** 虚线的落点：吸上了就画到吸附点上，没吸上就跟着指针。 */
const tipPoint = computed<Pt | null>(() => {
  const drop = target.value
  const at = origin.value
  if (drop === null || at === null) return tip.value
  const pair = pairOf(drop.nodeId)
  return pair === null
    ? tip.value
    : resolveEdgeEnd(drop, pair.node, pair.style, at).point
})

// ⚠ 认的是「换了一个 event 对象」而不是「source 非空」：调用方忘了清空时，
// 任何一次重渲染都会再起一次手势，表现是松手之后线还黏在指针上
watch(
  () => props.source,
  (next) => {
    if (next === null || next.event === started) return
    started = next.event
    begin(next.nodeId, next.portId, next.event)
  },
)

// ⚠ 拉到一半被卸载也按「落定」收：够得着目标就连上，够不着才丢
onBeforeUnmount(() => {
  if (!live) return
  finish('interrupted')
  props.cancelGesture()
})
</script>

<template>
  <svg
    v-if="origin !== null && tipPoint !== null"
    class="dt-connect"
    :viewBox="viewBox"
    :width="canvas.width"
    :height="canvas.height"
    aria-hidden="true"
    data-test="connect-preview"
  >
    <line
      class="dt-connect__line"
      :x1="origin.x"
      :y1="origin.y"
      :x2="tipPoint.x"
      :y2="tipPoint.y"
      data-test="connect-line"
    />
    <circle
      v-if="target !== null"
      class="dt-connect__dot"
      :cx="tipPoint.x"
      :cy="tipPoint.y"
      :r="dotRadius"
      data-test="connect-dot"
    />
  </svg>
</template>

<style scoped lang="scss">
.dt-connect {
  position: absolute;
  inset: 0;
  overflow: visible;
  // 预览只是画给人看的，指针要能一路落到底下的节点上
  pointer-events: none;
}

.dt-connect__line {
  stroke: var(--accent-primary);
  stroke-dasharray: 6 4;
  // ⚠ 线宽不跟着缩放走：缩小时预览会细到看不见，而它正是这一手唯一的反馈
  vector-effect: non-scaling-stroke;
  stroke-width: 1.5;
}

.dt-connect__dot {
  fill: var(--accent-primary);
}
</style>
