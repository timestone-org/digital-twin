/**
 * @fileoverview 在一份图草稿上做的那些纯操作：压栈、落节点、删、改参数、挪位置。
 *
 * 这些全都不碰响应式状态，只认「进来一份草稿、出去一份草稿」，于是每一条都能
 * 单独测，也不会有人在这里顺手动了 ref。
 */
import type { ModelingGraph, ModelingGraphNode } from '@dt/contracts'

import type { CanvasPoint } from './useCanvasViewport'

/** 撤销栈的上限。 */
const MAX_HISTORY = 50

/** 连着落节点时每次错开多少像素。 */
const CASCADE_STEP = 32

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

export function pushNode(
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

export function applyMoves(
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
