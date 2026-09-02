/**
 * @fileoverview 画布上那张图的唯一真源：增删节点与边、拖动、脏标记、撤销与重做。
 */
import type {
  ModelingGraph,
  ModelingGraphEdge,
  ModelingGraphNode,
} from '@dt/contracts'
import { computed, shallowRef } from 'vue'

import {
  advance,
  applyAlias,
  applyConfig,
  applyMoves,
  dropEdges,
  dropNodes,
  pasteInto,
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

/** 改节点的那几个动作。都走 `commit`，于是每一个都自带一步撤销。 */
function nodeMutations(commit: Commit) {
  return {
    /** 落一个新节点，回它的 id。`config` 给算子 schema 的默认值。 */
    addNode: (
      operator: string,
      at: CanvasPoint,
      config: Record<string, unknown> = {},
    ): string => {
      let id = ''
      commit((draft) => {
        id = pushNode(draft, operator, at, config)
      })
      return id
    },
    /** 删一批节点，连同挂在它们身上的边。 */
    removeNodes: (ids: readonly string[]) =>
      commit((draft) => dropNodes(draft, ids)),
    /** 改一个节点的参数。 */
    setConfig: (id: string, config: Record<string, unknown>) =>
      commit((draft) => applyConfig(draft, id, config)),
    /** 改一个节点的显示名。 */
    setAlias: (id: string, alias: string) =>
      commit((draft) => applyAlias(draft, id, alias)),
    /** 把一批节点挪到新位置。**一次拖动结束才调一次**，不是逐帧。 */
    moveNodes: (moves: ReadonlyMap<string, CanvasPoint>) =>
      commit((draft) => applyMoves(draft, moves)),
  }
}

/** 改边、以及跨节点与边的那两个动作。 */
function edgeMutations(commit: Commit) {
  return {
    /** 删一批边。 */
    removeEdges: (ids: readonly string[]) =>
      commit((draft) => dropEdges(draft, ids)),
    /** 接一条边。合法性由 `useCanvasWiring` 在手势结束时判过。 */
    addEdge: (edge: ModelingGraphEdge) =>
      commit((draft) => {
        draft.edges.push(edge)
      }),
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
    /** 粘一批节点连同它们内部的边，回新节点的 id。 */
    paste: (
      nodes: readonly ModelingGraphNode[],
      edges: readonly ModelingGraphEdge[],
      offset: CanvasPoint,
    ): string[] => {
      let pasted: string[] = []
      if (nodes.length === 0) return pasted
      commit((draft) => {
        pasted = pasteInto(draft, nodes, edges, offset)
      })
      return pasted
    },
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
  const future = shallowRef<ModelingGraph[]>([])
  const isDirty = shallowRef(false)

  const nodeIds = computed(() => graph.value.nodes.map((item) => item.id))
  const edgeIds = computed(() => graph.value.edges.map((item) => item.id))
  const canUndo = computed(() => history.value.length > 0)
  const canRedo = computed(() => future.value.length > 0)

  /**
   * 提交一步：先把当前状态压栈，再让调用方改。
   *
   * ⚠ 提交要把重做栈清空：留着的话，改了一笔之后按重做会跳回另一条已经被覆盖
   * 的分支上，图会变成用户没画过的样子。
   */
  const commit: Commit = (change) => {
    const next = advance(graph.value, change)
    history.value = pushHistory(history.value, graph.value)
    future.value = []
    graph.value = next
    isDirty.value = true
  }

  /** 在两个栈之间挪一步。方向由传进来的这两个栈决定。 */
  function step(from: typeof history, to: typeof future): void {
    const previous = from.value.at(-1)
    if (previous === undefined) return
    from.value = from.value.slice(0, -1)
    to.value = [...to.value, graph.value]
    graph.value = previous
    isDirty.value = true
  }

  return {
    graph,
    nodeIds,
    edgeIds,
    canUndo,
    canRedo,
    isDirty,
    commit,
    ...nodeMutations(commit),
    ...edgeMutations(commit),
    /** 换一整张图。载图与只读回看都走它，**不进撤销栈**。 */
    reset: (next: ModelingGraph | null) => {
      graph.value = structuredClone(next ?? EMPTY_GRAPH)
      history.value = []
      future.value = []
      isDirty.value = false
    },
    /** 退回上一步。 */
    undo: () => step(history, future),
    /** 把撤销掉的那一步再做一遍。 */
    redo: () => step(future, history),
    /** 存盘之后调，把「有未保存改动」清掉。 */
    markSaved: () => {
      isDirty.value = false
    },
  }
}
