/**
 * @fileoverview 画布上那张图的唯一真源：增删节点与边、拖动、脏标记、撤销。
 *
 * ⚠ 节点 id 用 `getRandomValues` 拼，**不用 `crypto.randomUUID`**——后者只在
 * secure context 存在，而本项目是纯 HTTP 内网部署，那里它是 undefined。
 */
import type {
  ModelingGraph,
  ModelingGraphEdge,
  ModelingGraphNode,
} from '@dt/contracts'
import { computed, shallowRef } from 'vue'

import type { CanvasPoint } from './useCanvasViewport'

/** 撤销栈最多留几步。再深也没人按得回去，只是白占内存。 */
const MAX_HISTORY = 50
/** 新节点落点的错开步长，免得连拖两个叠在一起。 */
const CASCADE_STEP = 32

const EMPTY_GRAPH: ModelingGraph = {
  format_version: '1.0',
  nodes: [],
  edges: [],
}

/** 一张图上的编辑状态。 */
type Commit = (change: (draft: ModelingGraph) => void) => void

/** 六个改图动作。都走 `commit`，于是每一个都自带一步撤销。 */
function mutations(commit: Commit) {
  return {
    /** 落一个新节点。`config` 给算子 schema 的默认值。 */
    addNode: (
      operator: string,
      at: CanvasPoint,
      config: Record<string, unknown> = {},
    ) => commit((draft) => pushNode(draft, operator, at, config)),
    /** 删一批节点，连同挂在它们身上的边。 */
    removeNodes: (ids: readonly string[]) =>
      commit((draft) => dropNodes(draft, ids)),
    /** 删一批边。 */
    removeEdges: (ids: readonly string[]) =>
      commit((draft) => dropEdges(draft, ids)),
    /** 接一条边。合法性由 `useCanvasWiring` 在手势结束时判过。 */
    addEdge: (edge: ModelingGraphEdge) =>
      commit((draft) => {
        draft.edges.push(edge)
      }),
    /** 改一个节点的参数。 */
    setConfig: (id: string, config: Record<string, unknown>) =>
      commit((draft) => applyConfig(draft, id, config)),
    /** 把一批节点挪到新位置。**一次拖动结束才调一次**，不是逐帧。 */
    moveNodes: (moves: ReadonlyMap<string, CanvasPoint>) =>
      commit((draft) => applyMoves(draft, moves)),
  }
}

export function useModelingGraph() {
  /**
   * ⚠ 必须是 `shallowRef`：`ref` 会把整张图深包成响应式 Proxy，而 `structuredClone`
   * 对 Proxy 一律抛 `DataCloneError`——图状态是整份替换的写法，第一次落节点就会
   * 在克隆那一步炸掉。整份替换也用不上深响应式。
   */
  const graph = shallowRef<ModelingGraph>(structuredClone(EMPTY_GRAPH))
  const history = shallowRef<ModelingGraph[]>([])
  const isDirty = shallowRef(false)

  const nodeIds = computed(() => graph.value.nodes.map((item) => item.id))
  const edgeIds = computed(() => graph.value.edges.map((item) => item.id))
  const canUndo = computed(() => history.value.length > 0)

  /** 提交一步：先把当前状态压栈，再让调用方改。 */
  const commit: Commit = (change) => {
    const next = advance(graph.value, change)
    history.value = pushHistory(history.value, graph.value)
    graph.value = next
    isDirty.value = true
  }

  return {
    graph,
    nodeIds,
    edgeIds,
    canUndo,
    isDirty,
    commit,
    ...mutations(commit),
    /** 换一整张图。载图与只读回看都走它，**不进撤销栈**。 */
    reset: (next: ModelingGraph | null) => {
      graph.value = structuredClone(next ?? EMPTY_GRAPH)
      history.value = []
      isDirty.value = false
    },
    /** 退回上一步。 */
    undo: () => {
      const previous = history.value.at(-1)
      if (previous === undefined) return
      history.value = history.value.slice(0, -1)
      graph.value = previous
      isDirty.value = true
    },
    /** 存盘之后调，把「有未保存改动」清掉。 */
    markSaved: () => {
      isDirty.value = false
    },
  }
}

/**
 * 把当前状态压进撤销栈。
 *
 * ⚠ 栈是**有上限**的：图上每挪一次节点都压一份深拷贝，不封顶的话一个开着改
 * 半天的画布能把几百份整图留在内存里。
 */
function pushHistory(
  history: readonly ModelingGraph[],
  current: ModelingGraph,
): ModelingGraph[] {
  return [...history, structuredClone(current)].slice(-MAX_HISTORY)
}

/** 在一份拷贝上改，改完把新的那份给回来。原图不动。 */
function advance(
  current: ModelingGraph,
  change: (draft: ModelingGraph) => void,
): ModelingGraph {
  const draft = structuredClone(current)
  change(draft)
  return draft
}

function pushNode(
  draft: ModelingGraph,
  operator: string,
  at: CanvasPoint,
  config: Record<string, unknown>,
): void {
  const node = newNode(operator, cascade(at, draft.nodes.length))
  // ⚠ 参数在这里就落好 schema 默认值：留空的话新节点带着一堆 undefined 去跑，
  // 报出来的是后端的字段校验错，读起来像是算子本身坏了
  node.config = config
  draft.nodes.push(node)
}

function dropNodes(draft: ModelingGraph, ids: readonly string[]): void {
  const gone = new Set(ids)
  draft.nodes = draft.nodes.filter((item) => !gone.has(item.id))
  draft.edges = draft.edges.filter(
    (edge) => !gone.has(edge.from_node) && !gone.has(edge.to_node),
  )
}

function dropEdges(draft: ModelingGraph, ids: readonly string[]): void {
  const gone = new Set(ids)
  draft.edges = draft.edges.filter((edge) => !gone.has(edge.id))
}

function applyConfig(
  draft: ModelingGraph,
  id: string,
  config: Record<string, unknown>,
): void {
  const node = draft.nodes.find((item) => item.id === id)
  if (node !== undefined) node.config = config
}

function applyMoves(
  draft: ModelingGraph,
  moves: ReadonlyMap<string, CanvasPoint>,
): void {
  for (const node of draft.nodes) {
    const at = moves.get(node.id)
    if (at !== undefined) node.position = { ...at }
  }
}

/** 一个新节点。 */
function newNode(operator: string, at: CanvasPoint): ModelingGraphNode {
  return { id: newNodeId(), operator, alias: '', config: {}, position: at }
}

/**
 * 一个新节点 id。
 *
 * ⚠ 不用 `crypto.randomUUID()`：它只在 secure context 里存在，纯 HTTP 部署下
 * 是 undefined，而那时报的错是「randomUUID is not a function」，看着像浏览器
 * 太老。`getRandomValues` 没有这个限制。
 */
function newNodeId(): string {
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  return [...bytes].map((item) => item.toString(16).padStart(2, '0')).join('')
}

/** 连着落好几个节点时错开一点，免得叠在一起。 */
function cascade(at: CanvasPoint, count: number): CanvasPoint {
  const offset = (count % 5) * CASCADE_STEP
  return { left: at.left + offset, top: at.top + offset }
}
