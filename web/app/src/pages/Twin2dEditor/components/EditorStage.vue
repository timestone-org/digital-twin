<script setup lang="ts">
/**
 * @fileoverview 编辑画布的装配层：把各层按运行态 `Twin2dStage` 的层序摆进视口壳，
 * 把它们上抛的命中收进选中态，把一手势一次的改动收成整份新配置交给页面落 commit。
 *
 * ⚠ 层序与 `Twin2dStage` 逐层对齐（标注 below → 连线 → 节点 → 标注 above，编辑器
 * 特有的把手 / 预览 / 框选压在最上）：编辑器另排一套的话，配了 `below` 的标注在这里
 * 看着在上面、上了大屏跑到下面，而两边单看都对（§7.10 #74）。
 * ⚠ 底图与图案两层只活在 `Twin2dStage` 里（求值函数没出包），编辑器的底是网格；
 * 在这里另写一份求值就是第二处口径，改一处必漏另一处。
 * ⚠ 视口、手势与两向换算全从插槽里接，本层一份都不存：存一份就是第二份真源，
 * 而两份对不上的表现是「画出来的位置与点得中的位置差一截」。
 * ⚠ 本层一个字都不写文档：改动整份上抛，撤销栈归页面的文档态。
 */
import { resolveImageValue } from '@dt/modules'
import {
  TWIN_2D_BUILTIN_NODE_STYLES,
  TWIN_2D_EDGE_PRESETS,
  normalizeEdge,
  uniqueBy,
} from '@dt/twin2d'
import type {
  Pt,
  Twin2dConfig,
  Twin2dEdge,
  Twin2dEndpoint,
  Twin2dMark,
  Twin2dNode,
  Twin2dNodeStyle,
  Twin2dWaypoint,
} from '@dt/twin2d'
import { computed, shallowRef } from 'vue'

import { newClientUuid } from '@/api/idempotency'

import { markSnapBox, nodeSnapBox, pointsBox } from '../scripts/entityBoxes'
import type { Twin2dEntityBox } from '../scripts/entityBoxes'
import type {
  Twin2dEditorSelection,
  Twin2dPickKind,
} from '../scripts/editorSelection'
import { TWIN_2D_DEFAULT_SNAP } from '../scripts/snapping'
import type { Twin2dGuideLine, Twin2dSnapBox } from '../scripts/snapping'
import { edgePolyline } from '../scripts/waypointOps'
import CanvasConnectPreview from './CanvasConnectPreview.vue'
import CanvasEdgeHandles from './CanvasEdgeHandles.vue'
import CanvasEdgeLayer from './CanvasEdgeLayer.vue'
import CanvasMarkLayer from './CanvasMarkLayer.vue'
import CanvasMarquee from './CanvasMarquee.vue'
import CanvasNodeLayer from './CanvasNodeLayer.vue'
import EditorCanvas from './EditorCanvas.vue'

/** 从一个端口拉线的那一手；换一个 `event` 对象即起一次新预览。 */
interface PortGrab {
  nodeId: string
  portId: string
  event: PointerEvent
}

const props = withDefaults(
  defineProps<{
    /** 整份 2D 孪生配置；本层只读，改动一律整份上抛。 */
    config: Twin2dConfig
    /** 画布这一条选中轴；大纲与检查器共用同一份。 */
    selection: Twin2dEditorSelection
    /** 「适应」的信号：每加一次就重新取一次景。 */
    fitRequest?: number
  }>(),
  { fitRequest: 0 },
)

const emit = defineEmits<{
  /** 一手势一次：整份新配置交给页面落一次 commit。 */
  change: [config: Twin2dConfig]
}>()

/**
 * ⚠ 模板里直接读 `fitRequest` 会被 `vue-tsc` 判成可能为 undefined（`withDefaults`
 * 的缺省值在它眼里不作数），所以从这里过一手，不在模板上撒 `?.`（同 `Twin2dStage`）。
 */
const fitAt = computed(() => props.fitRequest)

/** 从端口拉出来的那一手；null = 没在拉线。 */
const portGrab = shallowRef<PortGrab | null>(null)

/** 画布空白上按下的那一下；框选按它起手，null = 没在框。 */
const marqueeSource = shallowRef<PointerEvent | null>(null)

/** 拖把手期间的草稿边；连线层照它画，null = 照文档画。 */
const edgeDraft = shallowRef<Twin2dEdge | null>(null)

/** 标注层这一帧吸出来的参考线；参考线只有节点层一副画法。 */
const markGuides = shallowRef<readonly Twin2dGuideLine[]>([])

// 同 id 以文档里那一份为准，落不到才回预置库（§13.4）；`uniqueBy` 留最先出现的一条
const nodeStyles = computed<readonly Twin2dNodeStyle[]>(() =>
  uniqueBy(
    [...props.config.styles, ...TWIN_2D_BUILTIN_NODE_STYLES],
    (style) => style.id,
  ),
)

const edgeStyles = computed(() =>
  uniqueBy(
    [...props.config.edgeStyles, ...TWIN_2D_EDGE_PRESETS],
    (style) => style.id,
  ),
)

/** 吸附按这张图自己的栅格走；开关与阈值暂用缺省。 */
const snap = computed(() => ({
  ...TWIN_2D_DEFAULT_SNAP,
  grid: props.config.canvas.grid,
}))

const nodeIds = computed(() => props.selection.idsOf('nodes'))
const edgeIds = computed(() => props.selection.idsOf('edges'))
const markIds = computed(() => props.selection.idsOf('marks'))

/** 拖把手期间连线层照草稿画：不换的话线停在原处，只有把手在动。 */
const shownEdges = computed<readonly Twin2dEdge[]>(() => {
  const draft = edgeDraft.value
  if (draft === null) return props.config.edges
  return props.config.edges.map((edge) => (edge.id === draft.id ? draft : edge))
})

/** 出把手的那一条：只在单选一条连线时出。 */
const focusedEdge = computed<Twin2dEdge | null>(() => {
  const ids = edgeIds.value
  if (ids.length !== 1) return null
  return props.config.edges.find((edge) => edge.id === ids[0]) ?? null
})

/**
 * 一条连线在画布上的完整折线；框选盒按它取外接盒。
 * @param edge 连线实例
 */
function edgeLineOf(edge: Twin2dEdge): readonly Pt[] {
  return edgePolyline(
    edge,
    props.config.nodes,
    nodeStyles.value,
    edgeStyles.value,
  )
}

/**
 * 三类实体在画布上占的盒；框选按它判命中，标注拖动按其中的节点盒吸边线。
 * ⚠ 盒一律走 `entityBoxes`：在这里另算一份的话，转过 90° 的节点框得中的范围与它
 * 画出来的范围对不上，而两处单看都对。
 */
const entityBoxes = computed<readonly Twin2dEntityBox[]>(() => {
  const styles = new Map(nodeStyles.value.map((style) => [style.id, style]))
  const boxes: Twin2dEntityBox[] = []
  for (const node of props.config.nodes) {
    const style = styles.get(node.styleId)
    // 样式悬空的节点画不出来，也就框不中：与节点层「整个不画」同口径
    if (style === undefined) continue
    boxes.push({ kind: 'nodes', id: node.id, box: nodeSnapBox(node, style) })
  }
  for (const edge of props.config.edges) {
    const box = pointsBox(edgeLineOf(edge))
    if (box !== null) boxes.push({ kind: 'edges', id: edge.id, box })
  }
  for (const mark of props.config.marks) {
    boxes.push({ kind: 'marks', id: mark.id, box: markSnapBox(mark) })
  }
  return boxes
})

/** 标注能吸的层外盒只有节点那些；标注自己那几条由标注层补齐。 */
const nodeBoxes = computed<readonly Twin2dSnapBox[]>(() =>
  entityBoxes.value
    .filter((entry) => entry.kind === 'nodes')
    .map((entry) => entry.box),
)

/**
 * 命中一个实体：加选切换去留，否则整条轴换成这一个。
 * @param kind 这一类
 * @param id 命中的 id
 * @param additive 按住了 Ctrl / ⌘
 */
function pick(kind: Twin2dPickKind, id: string, additive: boolean): void {
  if (additive) props.selection.toggle(kind, id)
  else props.selection.select(kind, id)
}

/**
 * 命中一个节点。
 * @param id 命中的节点
 * @param additive 按住了 Ctrl / ⌘
 */
function pickNode(id: string, additive: boolean): void {
  pick('nodes', id, additive)
}

/**
 * 命中一条标注。
 * @param id 命中的标注
 * @param additive 按住了 Ctrl / ⌘
 */
function pickMark(id: string, additive: boolean): void {
  pick('marks', id, additive)
}

/**
 * 连线上按下：修饰键从事件上读，选中怎么算与另外两类同一条。
 * @param edgeId 这一条
 * @param event 那一下 pointerdown
 */
function pickEdge(edgeId: string, event: PointerEvent): void {
  pick('edges', edgeId, event.ctrlKey || event.metaKey)
}

/**
 * 换一份节点表。
 * @param nodes 整份新节点
 */
function commitNodes(nodes: readonly Twin2dNode[]): void {
  emit('change', { ...props.config, nodes })
}

/**
 * 换一份标注表。
 * @param marks 整份新标注
 */
function commitMarks(marks: readonly Twin2dMark[]): void {
  emit('change', { ...props.config, marks })
}

/**
 * 换一份连线表。
 * @param edges 整份新连线
 */
function commitEdges(edges: readonly Twin2dEdge[]): void {
  emit('change', { ...props.config, edges })
}

/**
 * 换掉整份里的一条连线，其余原样。
 * @param next 改过的那一条
 */
function commitEdge(next: Twin2dEdge): void {
  commitEdges(
    props.config.edges.map((edge) => (edge.id === next.id ? next : edge)),
  )
}

/**
 * 双击线上一点插了一个拐点。
 * @param edgeId 这一条
 * @param waypoints 整份新拐点
 */
function insertWaypoints(
  edgeId: string,
  waypoints: readonly Twin2dWaypoint[],
): void {
  const edge = props.config.edges.find((item) => item.id === edgeId)
  // ⚠ 走不到：id 就是连线层从这份表里拿的；留着只为收住 find 的可空
  if (edge === undefined) return
  commitEdge({ ...edge, waypoints })
}

/**
 * 拉线松手落到一个节点上：造一条新连线接上去。
 * ⚠ 造出来的那一条也过一遍 `normalizeEdge`：文档里只该有归一化过的形状，就地拼一个
 * 出来的话，某个缺省字段的取值会与读盘那一份不同，而差别只在下次读盘时显形。
 * @param from 起手那一端
 * @param to 落点那一端
 */
function connect(from: Twin2dEndpoint, to: Twin2dEndpoint): void {
  // 预置库恒非空，`??` 那一支走不到；留着只为收住下标可空
  const styleId = edgeStyles.value[0]?.id ?? ''
  const edge = normalizeEdge(
    { id: newClientUuid(), styleId, from, to },
    new Set(props.config.nodes.map((node) => node.id)),
  )
  // ⚠ 走不到：两端都是画布上真实节点，归一化没有丢弃它的理由
  if (edge === null) return
  commitEdges([...props.config.edges, edge])
}

/**
 * 标注层这一帧吸出来的参考线。
 * ⚠ 两层共用这一支：各写各的内联处理器，改一处必漏另一处。
 * @param lines 这一帧要画的参考线；手势收场时是空表
 */
function showGuides(lines: readonly Twin2dGuideLine[]): void {
  markGuides.value = lines
}

/** 拉线这一手收场了（连上或丢弃都发）。 */
function endConnect(): void {
  portGrab.value = null
}

/**
 * 从一个端口点起手。
 * @param nodeId 端口所在的节点
 * @param portId 端口
 * @param event 起手的那一下 pointerdown
 */
function grabPort(nodeId: string, portId: string, event: PointerEvent): void {
  portGrab.value = { nodeId, portId, event }
}

/**
 * 框住了一批同类实体。
 * @param kind 这一批的类别
 * @param ids 命中的 id
 * @param additive 按住了 Ctrl / ⌘
 */
function pickMany(
  kind: Twin2dPickKind,
  ids: readonly string[],
  additive: boolean,
): void {
  props.selection.selectMany(kind, ids, additive)
}
</script>

<template>
  <EditorCanvas
    :canvas="config.canvas"
    :fit-request="fitAt"
    @background-down="marqueeSource = $event"
  >
    <template #default="api">
      <CanvasMarkLayer
        :canvas="config.canvas"
        :marks="config.marks"
        layer="below"
        :selected-ids="markIds"
        :snap="snap"
        :scale="api.view.scale"
        :start-gesture="api.startGesture"
        :peers="nodeBoxes"
        :editable="true"
        @pick="pickMark"
        @change="commitMarks"
        @guides="showGuides"
      />
      <CanvasEdgeLayer
        :canvas="config.canvas"
        :edges="shownEdges"
        :edge-styles="edgeStyles"
        :nodes="config.nodes"
        :node-styles="nodeStyles"
        :selected-ids="edgeIds"
        :snap="snap"
        :scale="api.view.scale"
        :to-design="api.toDesign"
        @pick="pickEdge"
        @insert="insertWaypoints"
      />
      <CanvasNodeLayer
        :nodes="config.nodes"
        :node-styles="nodeStyles"
        :selected-ids="nodeIds"
        :snap="snap"
        :scale="api.view.scale"
        :start-gesture="api.startGesture"
        :resolve-icon="resolveImageValue"
        :extra-guides="markGuides"
        @pick="pickNode"
        @change="commitNodes"
        @port-grab="grabPort"
      />
      <CanvasMarkLayer
        :canvas="config.canvas"
        :marks="config.marks"
        layer="above"
        :selected-ids="markIds"
        :snap="snap"
        :scale="api.view.scale"
        :start-gesture="api.startGesture"
        :peers="nodeBoxes"
        :editable="true"
        @pick="pickMark"
        @change="commitMarks"
        @guides="showGuides"
      />
      <CanvasEdgeHandles
        v-if="focusedEdge !== null"
        :canvas="config.canvas"
        :edge="focusedEdge"
        :nodes="config.nodes"
        :node-styles="nodeStyles"
        :edge-styles="edgeStyles"
        :snap="snap"
        :scale="api.view.scale"
        :start-gesture="api.startGesture"
        :cancel-gesture="api.cancelGesture"
        @preview="edgeDraft = $event"
        @change="commitEdge"
      />
      <CanvasConnectPreview
        :canvas="config.canvas"
        :source="portGrab"
        :nodes="config.nodes"
        :node-styles="nodeStyles"
        :scale="api.view.scale"
        :start-gesture="api.startGesture"
        :cancel-gesture="api.cancelGesture"
        @connect="connect"
        @done="endConnect"
      />
      <CanvasMarquee
        :canvas="config.canvas"
        :targets="entityBoxes"
        :source="marqueeSource"
        :start-gesture="api.startGesture"
        @pick="pickMany"
        @clear="selection.clear()"
        @done="marqueeSource = null"
      />
    </template>
  </EditorCanvas>
</template>
