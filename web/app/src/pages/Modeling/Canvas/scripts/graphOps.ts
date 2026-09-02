/**
 * @fileoverview 在一份图草稿上做的那些纯操作：压栈、落节点、删、改参数、挪位置、
 * 复制一批节点。
 *
 * 这些全都不碰响应式状态，只认「进来一份草稿、出去一份草稿」，于是每一条都能
 * 单独测，也不会有人在这里顺手动了 ref。
 */
import type {
  ModelingGraph,
  ModelingGraphEdge,
  ModelingGraphNode,
} from '@dt/contracts'

import type { CanvasPoint } from './useCanvasViewport'

/** 撤销栈的上限。 */
const MAX_HISTORY = 50

export function pushHistory(
  history: readonly ModelingGraph[],
  current: ModelingGraph,
): ModelingGraph[] {
  return [...history, structuredClone(current)].slice(-MAX_HISTORY)
}

/** 在一份拷贝上改，改完把新的那份给回来。原图不动。 */
export function advance(
  current: ModelingGraph,
  change: (draft: ModelingGraph) => void,
): ModelingGraph {
  const draft = structuredClone(current)
  change(draft)
  return draft
}

/** 落一个新节点，回它的 id。位置由调用方算好——落点是拖拽给的还是级联给的，
 * 这里不该管。 */
export function pushNode(
  draft: ModelingGraph,
  operator: string,
  at: CanvasPoint,
  config: Record<string, unknown>,
): string {
  const node = newNode(operator, at)
  // ⚠ 参数在这里就落好 schema 默认值：留空的话新节点带着一堆 undefined 去跑，
  // 报出来的是后端的字段校验错，读起来像是算子本身坏了
  node.config = config
  draft.nodes.push(node)
  return node.id
}

export function dropNodes(draft: ModelingGraph, ids: readonly string[]): void {
  const gone = new Set(ids)
  draft.nodes = draft.nodes.filter((item) => !gone.has(item.id))
  draft.edges = draft.edges.filter(
    (edge) => !gone.has(edge.from_node) && !gone.has(edge.to_node),
  )
}

export function dropEdges(draft: ModelingGraph, ids: readonly string[]): void {
  const gone = new Set(ids)
  draft.edges = draft.edges.filter((edge) => !gone.has(edge.id))
}

export function applyConfig(
  draft: ModelingGraph,
  id: string,
  config: Record<string, unknown>,
): void {
  const node = draft.nodes.find((item) => item.id === id)
  if (node !== undefined) node.config = config
}

/** 改一个节点的显示名。空串表示回到用算子名当标题。 */
export function applyAlias(
  draft: ModelingGraph,
  id: string,
  alias: string,
): void {
  const node = draft.nodes.find((item) => item.id === id)
  if (node !== undefined) node.alias = alias
}

export function applyMoves(
  draft: ModelingGraph,
  moves: ReadonlyMap<string, CanvasPoint>,
): void {
  for (const node of draft.nodes) {
    const at = moves.get(node.id)
    if (at !== undefined) node.position = { ...at }
  }
}

/**
 * 把一批节点连同它们**内部**的边复制一份，回新节点的 id。
 *
 * ⚠ 只搬两端都在这批里的边：一端在外的边跟过来会凭空多出一个入口占用，而那个
 * 入口上原本的线还在——图会变成一个用户没画过的样子。
 *
 * @param nodes 要复制的那批节点（可以来自别的流水线）
 * @param edges 候选边
 * @param offset 落点相对原位置的位移
 */
export function pasteInto(
  draft: ModelingGraph,
  nodes: readonly ModelingGraphNode[],
  edges: readonly ModelingGraphEdge[],
  offset: CanvasPoint,
): string[] {
  const remap = new Map<string, string>()
  for (const node of nodes) {
    const copy = structuredClone(node)
    copy.id = newNodeId()
    copy.position = {
      left: node.position.left + offset.left,
      top: node.position.top + offset.top,
    }
    remap.set(node.id, copy.id)
    draft.nodes.push(copy)
  }
  for (const edge of edges) {
    const from = remap.get(edge.from_node)
    const to = remap.get(edge.to_node)
    if (from === undefined || to === undefined) continue
    draft.edges.push({
      id: `${from}:${edge.from_port}->${to}:${edge.to_port}`,
      from_node: from,
      from_port: edge.from_port,
      to_node: to,
      to_port: edge.to_port,
    })
  }
  return [...remap.values()]
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
