<script setup lang="ts">
/**
 * @fileoverview 自绘画布：平移缩放、拖拽、框选、拉线，都在这里。
 *
 * 视口与手势这些**观感**归它自己；图数据与选中集由页面持有再传进来，因为运行
 * 历史回看要能把同一块画布切成只读（MODELING_DESIGN §9.2）。
 */
import type { ModelingGraph, ModelingOperator } from '@dt/contracts'
import { computed, ref, watch } from 'vue'

import { useCanvasPointer } from '../scripts/useCanvasPointer'
import type { CanvasPoint } from '../scripts/useCanvasViewport'
import { useCanvasViewport } from '../scripts/useCanvasViewport'
import type { NodeRuntime } from '../scripts/nodeState'
import { EMPTY_RUNTIME } from '../scripts/nodeState'
import type { DrawnEdge } from '../scripts/useCanvasWiring'
import { portHitOf, verdictOf } from '../scripts/useCanvasWiring'
import { useNodeAnchors } from '../scripts/useNodeAnchors'

import EdgeLayer from './EdgeLayer.vue'
import ModelingNode from './ModelingNode.vue'

const props = defineProps<{
  graph: ModelingGraph
  operators: ReadonlyMap<string, ModelingOperator>
  runtime: ReadonlyMap<string, NodeRuntime>
  selection: { nodes: readonly string[]; edges: readonly string[] }
  isReadonly: boolean
}>()

const emit = defineEmits<{
  pickNode: [id: string, isAdditive: boolean]
  pickEdge: [id: string]
  pickNothing: []
  boxSelect: [ids: readonly string[]]
  moveNodes: [moves: ReadonlyMap<string, CanvasPoint>]
  connect: [
    from: { node: string; port: string },
    to: { node: string; port: string },
  ]
  reject: [reason: string]
  openConfig: [id: string]
  openResult: [id: string]
}>()

const host = ref<HTMLElement | null>(null)
const view = useCanvasViewport(host)
const anchors = useNodeAnchors()
/** 拖拽期间的临时位移。**不落进图数据**，松手才提交一步撤销。 */
const drift = ref<ReadonlyMap<string, CanvasPoint>>(new Map())

const pointer = useCanvasPointer(view.toCanvas, {
  onPan: view.pan,
  onDragMove: (ids, delta) => {
    drift.value = new Map(ids.map((id) => [id, delta]))
  },
  onDragEnd: (ids) => {
    emit('moveNodes', movedTo(ids))
    drift.value = new Map()
  },
  onMarquee: (from, to) => emit('boxSelect', inBox(from, to)),
  onWire: (from, target) => wire(from, target),
})

const selectedNodes = computed(() => new Set(props.selection.nodes))
const edges = computed<DrawnEdge[]>(() =>
  props.graph.edges.flatMap((edge) => {
    const from = anchorAt(edge.from_node, edge.from_port, 'out')
    const to = anchorAt(edge.to_node, edge.to_port, 'in')
    return from === null || to === null ? [] : [{ id: edge.id, from, to }]
  }),
)
const pending = computed<DrawnEdge | null>(() => {
  const gesture = pointer.gesture.value
  if (gesture.kind !== 'wiring') return null
  const from = anchorAt(gesture.fromNode, gesture.fromPort, 'out')
  return from === null ? null : { id: 'pending', from, to: gesture.to }
})

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
  return props.graph.nodes
    .filter((node) => {
      const rect = anchors.rectOf(props.graph, node.id)
      if (rect === null) return false
      return (
        rect.left < box.right &&
        rect.left + rect.width > box.left &&
        rect.top < box.bottom &&
        rect.top + rect.height > box.top
      )
    })
    .map((node) => node.id)
}

/** 松手时判一次：合法就连上，不合法把人话原样报给页面去弹提示。 */
function wire(
  from: { node: string; port: string },
  target: HTMLElement | null,
): void {
  const hit = portHitOf(target)
  if (hit === null) return
  const verdict = verdictOf(props.graph, props.operators, from, hit)
  if (!verdict.ok) return emit('reject', verdict.reason)
  emit('connect', from, { node: hit.node, port: hit.port })
}

/**
 * 按在一张卡片上。
 *
 * ⚠ 先看落点是不是接点：接点压在卡片里面，不先判的话按住接点会变成拖动整张
 * 卡片，用户永远拉不出一条线来。
 */
function onNodeDown(event: PointerEvent, id: string): void {
  const hit = portHitOf(event.target as HTMLElement | null)
  if (hit !== null && hit.side === 'out') {
    if (props.isReadonly) return
    return pointer.startWiring(event, hit.node, hit.port)
  }
  emit('pickNode', id, event.shiftKey)
  if (props.isReadonly) return
  const ids = selectedNodes.value.has(id) ? props.selection.nodes : [id]
  pointer.startDrag(event, ids)
}

/** 空白处：中键或按住空格拖是平移，直接拖是框选。 */
function onSurfaceDown(event: PointerEvent): void {
  emit('pickNothing')
  if (event.button === 1 || event.altKey) return pointer.startPan(event)
  if (props.isReadonly) return pointer.startPan(event)
  pointer.startMarquee(event)
}

function runtimeOf(id: string): NodeRuntime {
  return props.runtime.get(id) ?? EMPTY_RUNTIME
}

/** `v-for` 上的函数式 ref 会把组件实例也递过来，这里只要 DOM 元素。 */
function bindNode(id: string, target: unknown): void {
  anchors.bind(id, target instanceof Element ? target : null)
}

const gesture = computed(() => pointer.gesture.value)

/** 框选矩形的位置。它画在世界坐标之外，所以要自己乘一次缩放。 */
const marqueeStyle = computed(() => {
  const current = gesture.value
  if (current.kind !== 'marquee') return {}
  const { left, top, zoom } = view.viewport
  const box = {
    left: Math.min(current.from.left, current.to.left),
    top: Math.min(current.from.top, current.to.top),
    width: Math.abs(current.to.left - current.from.left),
    height: Math.abs(current.to.top - current.from.top),
  }
  return {
    left: `${box.left * zoom + left}px`,
    top: `${box.top * zoom + top}px`,
    width: `${box.width * zoom}px`,
    height: `${box.height * zoom}px`,
  }
})

// 视口自己从 host 里取元素，这里只负责等它挂上
watch(host, () => view.observe())

defineExpose({
  fit: () =>
    view.fit(
      props.graph.nodes.flatMap(
        (node) => anchors.rectOf(props.graph, node.id) ?? [],
      ),
    ),
})
</script>

<template>
  <div
    ref="host"
    class="dt-ml-canvas"
    @pointerdown.self="onSurfaceDown"
    @wheel.prevent="view.zoomAt($event.clientX, $event.clientY, -$event.deltaY)"
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
        @pick="(id) => emit('pickEdge', id)"
      />
      <div
        v-for="node in props.graph.nodes"
        :key="node.id"
        :ref="(element) => bindNode(node.id, element)"
        class="dt-ml-canvas__node"
        :style="{
          left: `${placeOf(node.id, node.position).left}px`,
          top: `${placeOf(node.id, node.position).top}px`,
        }"
        @pointerdown="onNodeDown($event, node.id)"
      >
        <ModelingNode
          :node="node"
          :spec="props.operators.get(node.operator)"
          :state="runtimeOf(node.id).state"
          :is-selected="selectedNodes.has(node.id)"
          :is-readonly="props.isReadonly"
          :error-text="runtimeOf(node.id).errorText"
          :has-result="runtimeOf(node.id).hasResult"
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
}
</style>
