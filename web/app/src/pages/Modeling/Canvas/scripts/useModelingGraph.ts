/**
 * @fileoverview 画布上那张图的唯一真源：增删节点与边、拖动、脏标记、撤销。
 *
 * ⚠ 节点 id 用 `getRandomValues` 拼，**不用 `crypto.randomUUID`**——后者只在
 * secure context 存在，而本项目是纯 HTTP 内网部署，那里它是 undefined。
 */
import type { ModelingGraph, ModelingGraphEdge } from '@dt/contracts'
import { computed, shallowRef } from 'vue'

import {
  advance,
  applyConfig,
  applyMoves,
  dropEdges,
  dropNodes,
  pushHistory,
  pushNode,
} from './graphOps'
import type { CanvasPoint } from './useCanvasViewport'

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
    /**
     * 删掉一整份选中（节点与边一起）。
     *
     * ⚠ 必须是**一次** commit：分两次提交的话，「删一下」在用户看来是一个动作，
     * 撤销键却要按两次才退得回来——第一次按下去画面纹丝不动，读起来就是撤销坏了。
     * 什么都没选中时**不提交**，否则撤销栈里会堆满按不出效果的空步。
     */
    removeSelection: (
      nodeIds: readonly string[],
      edgeIds: readonly string[],
    ) => {
      if (nodeIds.length === 0 && edgeIds.length === 0) return
      commit((draft) => {
        dropNodes(draft, nodeIds)
        dropEdges(draft, edgeIds)
      })
    },
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
