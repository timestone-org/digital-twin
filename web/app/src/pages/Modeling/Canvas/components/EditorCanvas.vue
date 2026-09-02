<script setup lang="ts">
/**
 * @fileoverview 自绘画布：平移缩放、拖拽、框选、拉线、吸附、落件、右键，都在这里。
 *
 * 视口与手势这些**观感**归它自己；图数据与选中集由页面持有再传进来，因为运行
 * 历史回看要能把同一块画布切成只读（MODELING_DESIGN §9.2）。
 */
import type { ModelingGraph, ModelingOperator } from '@dt/contracts'
import { computed, ref, watch } from 'vue'

import { OPERATOR_MIME } from '../scripts/dragMime'
import {
  CARD_HALF,
  ghostStyleOf,
  guideStylesOf,
  marqueeStyleOf,
} from '../scripts/overlayStyles'
import type { GuideLine, NodeRect } from '../scripts/nodeLayout'
import { snapAgainst, snapToGrid } from '../scripts/nodeLayout'
import type { NodeRuntime } from '../scripts/nodeState'
import { EMPTY_RUNTIME } from '../scripts/nodeState'
import { openPortsOf } from '../scripts/openPorts'
import type { WireEnd } from '../scripts/portHits'
import { NODE_ID_ATTR, portHitOf } from '../scripts/portHits'
import type { DrawnEdge } from '../scripts/edgeCurve'
import { useCanvasPointer } from '../scripts/useCanvasPointer'
import type { CanvasPoint } from '../scripts/useCanvasViewport'
import { useCanvasViewport } from '../scripts/useCanvasViewport'
import { dropEndOf, orderEnds, verdictOf } from '../scripts/useCanvasWiring'
import { useNodeAnchors } from '../scripts/useNodeAnchors'

import CanvasToolbar from './CanvasToolbar.vue'
import EdgeLayer from './EdgeLayer.vue'
import ModelingNode from './ModelingNode.vue'

/** 右键落在了什么上：一张卡片、一条线，或者空白处。 */
type MenuTarget = { nodeId: string | null; edgeId: string | null }

const props = defineProps<{
  graph: ModelingGraph
  operators: ReadonlyMap<string, ModelingOperator>
  runtime: ReadonlyMap<string, NodeRuntime>
  selection: { nodes: readonly string[]; edges: readonly string[] }
  isReadonly: boolean
  isSnapping: boolean
}>()

const emit = defineEmits<{
  pickNode: [id: string, isAdditive: boolean]
  pickEdge: [id: string]
  pickNothing: []
  boxSelect: [ids: readonly string[]]
  moveNodes: [moves: ReadonlyMap<string, CanvasPoint>]
  connect: [out: WireEnd, into: WireEnd]
  reject: [reason: string]
  removeEdge: [id: string]
  openConfig: [id: string]
  openResult: [id: string]
  dropOperator: [code: string, at: CanvasPoint]
  openMenu: [at: { x: number; y: number }, on: MenuTarget]
  autoLayout: []
  toggleSnap: []
}>()

/** 工具条按一下缩放多少。与滚轮一格同量级。 */
const ZOOM_RATIO = 1.25

const host = ref<HTMLElement | null>(null)
const view = useCanvasViewport(host)
const anchors = useNodeAnchors()
/** 拖拽期间的临时位移。**不落进图数据**，松手才提交一步撤销。 */
const drift = ref<ReadonlyMap<string, CanvasPoint>>(new Map())
/** 拖拽期间贴上的那几条对齐线。 */
const guides = ref<readonly GuideLine[]>([])
/** 拖着算子在画布上空移动时的落点提示。 */
const dropAt = ref<CanvasPoint | null>(null)

const pointer = useCanvasPointer(view.toCanvas, {
  onPan: view.pan,
  onDragMove: (ids, delta) => moveBy(ids, delta),
  onDragEnd: (ids) => {
    emit('moveNodes', movedTo(ids))
    drift.value = new Map()
    guides.value = []
  },
  onMarquee: (from, to) => emit('boxSelect', inBox(from, to)),
  onWire: (from, target) => wire(from, target),
})

const gesture = computed(() => pointer.gesture.value)
const selectedNodes = computed(() => new Set(props.selection.nodes))
const wiringFrom = computed<WireEnd | null>(() =>
  gesture.value.kind === 'wiring' ? gesture.value.from : null,
)
const openPorts = computed(() =>
  openPortsOf(props.graph, props.operators, wiringFrom.value),
)
const edges = computed<DrawnEdge[]>(() =>
  props.graph.edges.flatMap((edge) => {
    const from = anchorAt(edge.from_node, edge.from_port, 'out')
    const to = anchorAt(edge.to_node, edge.to_port, 'in')
    return from === null || to === null ? [] : [{ id: edge.id, from, to }]
  }),
)
const pending = computed<DrawnEdge | null>(() => {
  const from = wiringFrom.value
  if (from === null || gesture.value.kind !== 'wiring') return null
  const at = anchorAt(from.node, from.port, from.side)
  return at === null ? null : { id: 'pending', from: at, to: gesture.value.to }
})

/**
 * 拖动中把这批节点挪这么远，并在贴近别的卡片时吸上去。
 *
 * ⚠ 吸附只按**头一张**卡片算，算出的修正量整批共用：逐张各吸各的会把选中集
 * 拆散——用户拖的是一组，松手却发现它们之间的相对位置变了。
 */
function moveBy(ids: readonly string[], delta: CanvasPoint): void {
  const moved = props.isSnapping ? snapped(ids, delta) : { delta, lines: [] }
  guides.value = moved.lines
  drift.value = new Map(ids.map((id) => [id, moved.delta]))
}

/** 吸附之后的位移，以及要画的参考线。 */
function snapped(
  ids: readonly string[],
  delta: CanvasPoint,
): { delta: CanvasPoint; lines: GuideLine[] } {
  const dragging = new Set(ids)
  const rects = anchors.rectsOf(props.graph)
  const lead = rects.find((rect) => rect.id === ids[0])
  if (lead === undefined) return { delta, lines: [] }
  const at: NodeRect = {
    ...lead,
    left: lead.left + delta.left,
    top: lead.top + delta.top,
  }
  const others = rects.filter((rect) => !dragging.has(rect.id))
  const hit = snapAgainst(at, others, view.viewport.zoom)
  return {
    delta: {
      left: delta.left + hit.delta.left,
      top: delta.top + hit.delta.top,
    },
    lines: hit.guides,
  }
}

/** 拖拽中的节点用临时位移画，其余用图里的位置。 */
function placeOf(id: string, at: CanvasPoint): CanvasPoint {
  const delta = drift.value.get(id)
  if (delta === undefined) return at
  return { left: at.left + delta.left, top: at.top + delta.top }
}

function anchorAt(
  node: string,
  port: string,
  side: 'in' | 'out',
): CanvasPoint | null {
  const at = anchors.anchorOf(props.graph, props.operators, {
    node,
    port,
    side,
  })
  return at === null ? null : placeOf(node, at)
}

function movedTo(ids: readonly string[]): ReadonlyMap<string, CanvasPoint> {
  const moves = new Map<string, CanvasPoint>()
  for (const id of ids) {
    const node = props.graph.nodes.find((item) => item.id === id)
    if (node !== undefined) moves.set(id, placeOf(id, node.position))
  }
  return moves
}

function inBox(from: CanvasPoint, to: CanvasPoint): readonly string[] {
  const box = {
    left: Math.min(from.left, to.left),
    top: Math.min(from.top, to.top),
    right: Math.max(from.left, to.left),
    bottom: Math.max(from.top, to.top),
  }
  return anchors
    .rectsOf(props.graph)
    .filter(
      (rect) =>
        rect.left < box.right &&
        rect.left + rect.width > box.left &&
        rect.top < box.bottom &&
        rect.top + rect.height > box.top,
    )
    .map((rect) => rect.id)
}

/** 松手时判一次：合法就连上，不合法把人话原样报给页面去弹提示。 */
function wire(from: WireEnd, target: HTMLElement | null): void {
  const hit = dropEndOf(props.graph, props.operators, from, target)
  if (hit === null) return
  const ends = orderEnds(from, hit)
  if (ends === null) {
    return emit('reject', '出口要接到入口上，同一侧的两个口连不起来')
  }
  const verdict = verdictOf(props.graph, props.operators, ends.out, ends.into)
  if (!verdict.ok) return emit('reject', verdict.reason)
  emit('connect', ends.out, ends.into)
}

/**
 * 按在一张卡片上。
 *
 * ⚠ 先看落点是不是接点：接点压在卡片里面，不先判的话按住接点会变成拖动整张
 * 卡片，用户永远拉不出一条线来。
 */
function onNodeDown(event: PointerEvent, id: string): void {
  if (event.button !== 0) return
  const hit = portHitOf(
    event.target instanceof HTMLElement ? event.target : null,
  )
  if (hit !== null) {
    if (props.isReadonly) return
    return pointer.startWiring(event, hit)
  }
  emit('pickNode', id, event.shiftKey || event.metaKey || event.ctrlKey)
  if (props.isReadonly) return
  const ids = selectedNodes.value.has(id) ? props.selection.nodes : [id]
  pointer.startDrag(event, ids)
}

/** 空白处：中键或按住 Alt 拖是平移，直接拖是框选。 */
function onSurfaceDown(event: PointerEvent): void {
  if (event.button !== 0 && event.button !== 1) return
  emit('pickNothing')
  if (event.button === 1 || event.altKey) return pointer.startPan(event)
  if (props.isReadonly) return pointer.startPan(event)
  pointer.startMarquee(event)
}

function onMenu(event: MouseEvent, on: MenuTarget): void {
  event.preventDefault()
  emit('openMenu', { x: event.clientX, y: event.clientY }, on)
}

/** 从算子面板拖进来：只认自定义 MIME，免得把别处拖来的文本当成一次添加。 */
function onDragOver(event: DragEvent): void {
  if (props.isReadonly || event.dataTransfer === null) return
  event.preventDefault()
  event.dataTransfer.dropEffect = 'copy'
  dropAt.value = view.toCanvas(event.clientX, event.clientY)
}

function onDrop(event: DragEvent): void {
  event.preventDefault()
  dropAt.value = null
  const code = event.dataTransfer?.getData(OPERATOR_MIME) ?? ''
  if (props.isReadonly || code === '') return
  const at = view.toCanvas(event.clientX, event.clientY)
  // 指针落在卡片正中而不是左上角——用户瞄的是卡片本身
  const centered = {
    left: at.left - CARD_HALF.left,
    top: at.top - CARD_HALF.top,
  }
  emit('dropOperator', code, props.isSnapping ? snapToGrid(centered) : centered)
}

function runtimeOf(id: string): NodeRuntime {
  return props.runtime.get(id) ?? EMPTY_RUNTIME
}

/** `v-for` 上的函数式 ref 会把组件实例也递过来，这里只要 DOM 元素。 */
function bindNode(id: string, target: unknown): void {
  anchors.bind(id, target instanceof Element ? target : null)
}

const marqueeStyle = computed(() => {
  const current = gesture.value
  if (current.kind !== 'marquee') return {}
  return marqueeStyleOf(view.viewport, current.from, current.to)
})

const guideStyles = computed(() => guideStylesOf(view.viewport, guides.value))

const ghostStyle = computed(() => {
  const at = dropAt.value
  return at === null ? {} : ghostStyleOf(view.viewport, at)
})

/** 选中与拖拽中的卡片压在最上面，免得它的接点被邻居盖住。 */
function layerOf(id: string): number {
  if (drift.value.has(id)) return 3
  return selectedNodes.value.has(id) ? 2 : 1
}

function fitAll(): void {
  view.fit(
    props.graph.nodes.flatMap(
      (node) => anchors.rectOf(props.graph, node.id) ?? [],
    ),
  )
}

// 视口自己从 host 里取元素，这里只负责等它挂上
watch(host, () => view.observe())

defineExpose({
  fit: fitAll,
  /** 各卡片的实测矩形与尺寸；对齐、分布与一键整理都要它。 */
  rects: () => anchors.rectsOf(props.graph),
  sizes: () => anchors.sizes,
  /** 视口正中那一点的画布坐标，点算子面板时新卡片落在这里。 */
  center: (): CanvasPoint => {
    const box = host.value?.getBoundingClientRect()
    return view.toCanvas(
      (box?.left ?? 0) + (box?.width ?? 0) / 2,
      (box?.top ?? 0) + (box?.height ?? 0) / 2,
    )
  },
})
</script>

<template>
  <div
    ref="host"
    class="dt-ml-canvas"
    @pointerdown.self="onSurfaceDown"
    @contextmenu.self="onMenu($event, { nodeId: null, edgeId: null })"
    @wheel.prevent="view.zoomAt($event.clientX, $event.clientY, $event.deltaY)"
    @dragover="onDragOver"
    @dragleave="dropAt = null"
    @drop="onDrop"
  >
    <div
      class="dt-ml-canvas__world"
      :style="{
        transform: `translate(${view.viewport.left}px, ${view.viewport.top}px) scale(${view.viewport.zoom})`,
      }"
    >
      <EdgeLayer
        :edges="edges"
        :pending="pending"
        :selected-ids="props.selection.edges"
        :is-readonly="props.isReadonly"
        @pick="(id) => emit('pickEdge', id)"
        @remove="(id) => emit('removeEdge', id)"
        @menu="(id, at) => emit('openMenu', at, { nodeId: null, edgeId: id })"
      />
      <div
        v-for="node in props.graph.nodes"
        :key="node.id"
        :ref="(element) => bindNode(node.id, element)"
        class="dt-ml-canvas__node"
        :style="{
          left: `${placeOf(node.id, node.position).left}px`,
          top: `${placeOf(node.id, node.position).top}px`,
          zIndex: layerOf(node.id),
        }"
        v-bind="{ [NODE_ID_ATTR]: node.id }"
        @pointerdown="onNodeDown($event, node.id)"
        @contextmenu="onMenu($event, { nodeId: node.id, edgeId: null })"
      >
        <ModelingNode
          :node="node"
          :spec="props.operators.get(node.operator)"
          :state="runtimeOf(node.id).state"
          :is-selected="selectedNodes.has(node.id)"
          :is-readonly="props.isReadonly"
          :error-text="runtimeOf(node.id).errorText"
          :headline="runtimeOf(node.id).headline"
          :has-result="runtimeOf(node.id).hasResult"
          :open-ports="openPorts.get(node.id) ?? null"
          @open-config="emit('openConfig', node.id)"
          @open-result="emit('openResult', node.id)"
        />
      </div>
    </div>
    <div
      v-if="gesture.kind === 'marquee'"
      class="dt-ml-canvas__marquee"
      :style="marqueeStyle"
    />
    <div
      v-if="dropAt !== null"
      class="dt-ml-canvas__ghost"
      :style="ghostStyle"
    />
    <div
      v-for="line in guideStyles"
      :key="line.key"
      class="dt-ml-canvas__guide"
      :class="
        line.isVertical ? 'dt-ml-canvas__guide--v' : 'dt-ml-canvas__guide--h'
      "
      :style="line.style"
    />
    <CanvasToolbar
      :zoom="view.viewport.zoom"
      :is-snapping="props.isSnapping"
      :is-readonly="props.isReadonly"
      :has-nodes="props.graph.nodes.length > 0"
      @zoom-in="view.zoomTo(view.viewport.zoom * ZOOM_RATIO)"
      @zoom-out="view.zoomTo(view.viewport.zoom / ZOOM_RATIO)"
      @reset-zoom="view.zoomTo(1)"
      @fit="fitAll"
      @auto-layout="emit('autoLayout')"
      @toggle-snap="emit('toggleSnap')"
    />
  </div>
</template>

<style scoped lang="scss">
.dt-ml-canvas {
  position: relative;
  overflow: hidden;
  width: 100%;
  height: 100%;
  background: var(--surface-sunken);
  background-image: radial-gradient(var(--border-subtle) 1px, transparent 1px);
  background-size: 16px 16px;
  touch-action: none;

  &__world {
    position: absolute;
    top: 0;
    left: 0;
    transform-origin: 0 0;
  }

  &__node {
    position: absolute;
  }

  &__marquee {
    position: absolute;
    border: 1px solid var(--accent-primary);
    background: rgb(var(--accent-primary-rgb) / 0.12);
    pointer-events: none;
  }

  &__ghost {
    position: absolute;
    border: 1px dashed var(--accent-primary);
    border-radius: var(--radius-md);
    background: rgb(var(--accent-primary-rgb) / 0.1);
    pointer-events: none;
  }

  &__guide {
    position: absolute;
    z-index: 1;
    pointer-events: none;

    &--v {
      top: 0;
      bottom: 0;
      border-left: 1px dashed var(--state-warning);
    }

    &--h {
      right: 0;
      left: 0;
      border-top: 1px dashed var(--state-warning);
    }
  }
}
</style>
