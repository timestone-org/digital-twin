/** @fileoverview 按分支顺序与图纸宽度折返分行。 */
import type { Group, Metrics, Row } from './diagramTypes'
import { GAP, MARGIN } from './diagramTypes'
import { DomainError } from './graph'
import { required } from './required'
import type { GraphDocument, GraphNode } from './types'
function splitLevel(
  nodes: GraphNode[],
  rank: number,
  metrics: Map<string, Metrics>,
  available: number,
): Row[] {
  const rows: Row[] = []
  let row: Row = { rank, nodes: [], wrap: 0 },
    used = 0
  for (const node of nodes) {
    const width = required(metrics.get(node.id)).labelWidth
    if (width > available)
      throw new DomainError(
        '当前宽度不足以容纳节点和连线通道，请增大图纸宽度',
        'PAPER_TOO_NARROW',
      )
    if (row.nodes.length && used + GAP + width > available + 0.001) {
      rows.push(row)
      row = { rank, nodes: [], wrap: row.wrap + 1 }
      used = 0
    }
    used += (row.nodes.length ? GAP : 0) + width
    row.nodes.push(node)
  }
  if (row.nodes.length) rows.push(row)
  return rows
}
export function wrapRows(
  document: GraphDocument,
  depth: Map<string, number>,
  metrics: Map<string, Metrics>,
  gutter: number,
  groups: Group[],
): Row[] {
  const levels = new Map<number, GraphNode[]>(),
    rows: Row[] = []
  for (const node of document.nodes.filter((n) => n.kind === 'meter')) {
    const rank = required(depth.get(node.id))
    levels.set(rank, [...(levels.get(rank) || []), node])
  }
  const available = document.paper.width - MARGIN * 2 - gutter
  const order = new Map<string, number>()
  for (const [rank, nodes] of [...levels].sort(([a], [b]) => a - b)) {
    const upstream = (n: GraphNode) => {
      const parents = [
        ...new Set(
          groups
            .filter((g) => g.targets.includes(n.id))
            .flatMap((g) => g.sources),
        ),
      ]
      return parents.length
        ? parents.reduce((sum, id) => sum + (order.get(id) ?? 0.5), 0) /
            parents.length
        : 0
    }
    nodes.sort(
      (a, b) =>
        upstream(a) - upstream(b) ||
        a.order - b.order ||
        a.code.localeCompare(b.code) ||
        a.id.localeCompare(b.id),
    )
    nodes.forEach((node, index) =>
      order.set(node.id, (index + 0.5) / nodes.length),
    )
    rows.push(...splitLevel(nodes, rank, metrics, available))
  }
  return rows
}
