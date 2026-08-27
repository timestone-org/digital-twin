<script setup lang="ts">
/**
 * @fileoverview 编辑器的连线层：可见的线原样交给包里的 `Twin2dEdgeLayer`（所见即
 * 所得），底下再铺一条透明的粗命中带，用来点中一条 1.2px 的线、双击插拐点。
 *
 * ⚠ 命中带铺在可见线**下面**且只吃描边（`pointer-events: stroke`）：铺在上面会把
 * 箭头、标签与穿过去的节点一起挡掉，而它是透明的，谁也看不出是被什么挡住的。
 * ⚠ 命中带宽度按**屏幕**像素恒定（除回当前倍率）：不除的话缩到四分之一时它也跟着
 * 缩成三四个像素，表现是「缩小之后连线怎么都点不中」。
 */
import {
  TWIN_2D_DEFAULT_FLOW_SPEED,
  Twin2dEdgeLayer,
  buildEdgeViews,
} from '@dt/twin2d'
import type {
  Pt,
  Twin2dCanvas,
  Twin2dEdge,
  Twin2dEdgeStyle,
  Twin2dNode,
  Twin2dNodeStyle,
  Twin2dWaypoint,
} from '@dt/twin2d'
import { computed } from 'vue'

import { edgePolyline, insertWaypointOnPath } from '../scripts/waypointOps'
import type { Twin2dSnapOptions } from '../scripts/snapping'
import { canvasViewBox, screenToDesignPx } from '../scripts/viewportOps'
import type { Twin2dClientPoint } from '../scripts/viewportOps'

/** 命中带宽度（屏幕像素） */
const HIT_BAND_PX = 14
/** 选中那条线的光晕宽度（屏幕像素） */
const HALO_PX = 7

const props = defineProps<{
  canvas: Twin2dCanvas
  edges: readonly Twin2dEdge[]
  edgeStyles: readonly Twin2dEdgeStyle[]
  nodes: readonly Twin2dNode[]
  nodeStyles: readonly Twin2dNodeStyle[]
  /** 选中的连线 id；命中带上跟着出一圈光晕。 */
  selectedIds: readonly string[]
  snap: Twin2dSnapOptions
  /** 当前视口倍率。 */
  scale: number
  /** 指针 → 设计坐标；双击插拐点要用。 */
  toDesign: (at: Twin2dClientPoint) => Pt | null
}>()

const emit = defineEmits<{
  /** 命中带上按下：选中这一条；修饰键由调用方从事件上读。 */
  pick: [edgeId: string, event: PointerEvent]
  /** 双击线上一点插了一个拐点；整份新拐点表交给调用方落一次 commit。 */
  insert: [edgeId: string, waypoints: readonly Twin2dWaypoint[]]
}>()

const viewBox = computed(() => canvasViewBox(props.canvas))

/**
 * 命中带的 path 与可见线**同一份产物**：另算一遍几何就会出现「点在线上没反应、
 * 点在线旁边反而中了」，而两边单看都画得对。
 */
const bands = computed(() =>
  buildEdgeViews({
    edges: props.edges,
    edgeStyles: props.edgeStyles,
    nodes: props.nodes,
    nodeStyles: props.nodeStyles,
    states: {},
    flow: { animate: false, speed: TWIN_2D_DEFAULT_FLOW_SPEED },
  }).map((view) => ({
    id: view.id,
    path: view.path,
    picked: props.selectedIds.includes(view.id),
  })),
)

const halos = computed(() => bands.value.filter((band) => band.picked))

const bandWidth = computed(() => screenToDesignPx(HIT_BAND_PX, props.scale))

const haloWidth = computed(() => screenToDesignPx(HALO_PX, props.scale))

/**
 * 命中带上按下：只上抛，选中怎么算归调用方。
 * @param edgeId 这条连线
 * @param event 那一下 pointerdown
 */
function onPick(edgeId: string, event: PointerEvent): void {
  // ⚠ 这一按不许再冒到画布壳上：那边把落到自己身上的按下当成「点了空白」，
  // 不拦的表现是刚选中的连线在同一次按下里又被清掉
  event.stopPropagation()
  emit('pick', edgeId, event)
}

/**
 * 双击线上一点：按弧长找最近段插一个拐点。
 * ⚠ 落点算不出来（舞台还没挂上）时整个不做，绝不按 (0,0) 插一个拐点。
 * @param edgeId 这条连线
 * @param event 那一下双击
 */
function onInsert(edgeId: string, event: MouseEvent): void {
  const edge = props.edges.find((item) => item.id === edgeId)
  const at = props.toDesign(event)
  if (edge === undefined || at === null) return
  const points = edgePolyline(
    edge,
    props.nodes,
    props.nodeStyles,
    props.edgeStyles,
  )
  const next = insertWaypointOnPath(edge.waypoints, points, at, props.snap)
  emit('insert', edgeId, next)
}
</script>

<template>
  <div class="dt-edges" data-test="edge-layer">
    <svg
      class="dt-edges__hits"
      :viewBox="viewBox"
      :width="canvas.width"
      :height="canvas.height"
      aria-hidden="true"
    >
      <path
        v-for="halo in halos"
        :key="halo.id"
        class="dt-edges__halo"
        :d="halo.path"
        :stroke-width="haloWidth"
        data-test="edge-halo"
        :data-id="halo.id"
      />
      <path
        v-for="band in bands"
        :key="band.id"
        class="dt-edges__band"
        :d="band.path"
        :stroke-width="bandWidth"
        data-test="edge-hit"
        :data-id="band.id"
        @pointerdown="onPick(band.id, $event)"
        @dblclick="onInsert(band.id, $event)"
      />
    </svg>
    <Twin2dEdgeLayer
      :edges="edges"
      :edge-styles="edgeStyles"
      :nodes="nodes"
      :node-styles="nodeStyles"
      :width="canvas.width"
      :height="canvas.height"
    />
  </div>
</template>

<style scoped lang="scss">
.dt-edges {
  position: absolute;
  inset: 0;
  // 整层不吃指针：可见那一层在包里就是 pointer-events: none，命中只有命中带一处
  pointer-events: none;
}

.dt-edges__hits {
  position: absolute;
  inset: 0;
  // 端点箭头与多遍描边的外圈贴着边画，裁掉的话命中带比线短一截
  overflow: visible;
}

.dt-edges__halo {
  fill: none;
  stroke: var(--accent-primary);
  stroke-linecap: round;
  opacity: 0.35;
  pointer-events: none;
}

.dt-edges__band {
  fill: none;
  // ⚠ 透明而不是 `none`：`stroke: none` 的描边不吃指针，命中带就成了摆设
  stroke: transparent;
  stroke-linecap: round;
  pointer-events: stroke;
  cursor: pointer;
}
</style>
