/**
 * @fileoverview 一键整理：按拓扑分层把整张图重新排开。
 *
 * ⚠ 层号取**最长路径**而不是最短：按最短算的话，一个直接连到末端的旁路会把
 * 末端节点拽到很靠前的一层，于是边要往回画，读起来像是图接反了。
 */
import type { ModelingGraph } from '@dt/contracts'

import type { CanvasPoint } from './useCanvasViewport'

/** 层与层之间、同层上下之间留的空当（画布像素）。 */
const COLUMN_GAP = 96
const ROW_GAP = 40
/** 量不到实际尺寸时的兜底，与样式表里的卡片宽度一致。 */
const FALLBACK = { width: 224, height: 88 }

type Sizes = ReadonlyMap<string, { width: number; height: number }>

/** 每个节点的层号：没有上游的是第 0 层，其余是上游层号最大值 + 1。 */
function ranksOf(graph: ModelingGraph): Map<string, number> {
  const ranks = new Map<string, number>()
  const incoming = new Map<string, string[]>()
  for (const node of graph.nodes) incoming.set(node.id, [])
  for (const edge of graph.edges) {
    incoming.get(edge.to_node)?.push(edge.from_node)
  }
  // ⚠ 轮数必须封顶：连线时挡过成环，但一份从别处导入或被旧版本存坏的图仍可能
  // 带环，不封顶的话这里会转死循环——表现是整个页面卡住，连不上原因
  let changed = true
  for (let round = 0; changed && round <= graph.nodes.length; round += 1) {
    changed = false
    for (const node of graph.nodes) {
      const parents = incoming.get(node.id) ?? []
      const next = parents.reduce(
        (deep, parent) => Math.max(deep, (ranks.get(parent) ?? 0) + 1),
        0,
      )
      if (next === (ranks.get(node.id) ?? 0)) continue
      ranks.set(node.id, next)
      changed = true
    }
  }
  return ranks
}

/** 把节点按层号分桶，桶内保持它们在图里的原有次序。 */
function columnsOf(
  graph: ModelingGraph,
  ranks: ReadonlyMap<string, number>,
): string[][] {
  const columns: string[][] = []
  for (const node of graph.nodes) {
    const rank = ranks.get(node.id) ?? 0
    while (columns.length <= rank) columns.push([])
    columns[rank]?.push(node.id)
  }
  return columns
}

/** 一列的总高。 */
function heightOf(ids: readonly string[], sizes: Sizes): number {
  const boxes = ids.reduce(
    (sum, id) => sum + (sizes.get(id)?.height ?? FALLBACK.height),
    0,
  )
  return boxes + ROW_GAP * Math.max(0, ids.length - 1)
}

/**
 * 整张图重排后每个节点的新位置。
 *
 * @param graph 当前这张图
 * @param sizes 各卡片的实测尺寸；量不到的按兜底算
 * @param origin 整块版面的左上角
 */
export function layoutGraph(
  graph: ModelingGraph,
  sizes: Sizes,
  origin: CanvasPoint = { left: 80, top: 80 },
): Map<string, CanvasPoint> {
  const columns = columnsOf(graph, ranksOf(graph))
  const tallest = Math.max(
    0,
    ...columns.map((column) => heightOf(column, sizes)),
  )
  const moves = new Map<string, CanvasPoint>()
  let left = origin.left
  for (const column of columns) {
    // 每列在整块版面里居中，读起来像一条主干而不是一排左对齐的阶梯
    let top = origin.top + (tallest - heightOf(column, sizes)) / 2
    let widest = FALLBACK.width
    for (const id of column) {
      const size = sizes.get(id) ?? FALLBACK
      moves.set(id, { left, top })
      top += size.height + ROW_GAP
      widest = Math.max(widest, size.width)
    }
    left += widest + COLUMN_GAP
  }
  return moves
}
