/** @fileoverview 编辑画布按上下游关系分层并对齐分支。 */
import { alignBranches } from './diagramBranches'
import type { Group, Position, Row } from './diagramTypes'
import { editorSize } from './geometry'
import { ranks, validate } from './graph'
import { required } from './required'
import type { GraphDocument, GraphNode } from './types'

function orderedRows(document: GraphDocument): Row[] {
  const depth = ranks(document),
    levels = new Map<number, GraphNode[]>()
  for (const node of document.nodes) {
    const layer =
      required(depth.get(node.id)) * 2 + (node.kind === 'junction' ? 1 : 0)
    levels.set(layer, [...(levels.get(layer) ?? []), node])
  }
  const order = new Map<string, number>()
  const score = (node: GraphNode) => {
    const parents = document.edges
      .filter((edge) => edge.target === node.id)
      .map((edge) => edge.source)
    return parents.length
      ? parents.reduce((sum, id) => sum + (order.get(id) ?? 0.5), 0) /
          parents.length
      : 0
  }
  return [...levels]
    .sort(([first], [second]) => first - second)
    .map(([rank, nodes]) => {
      nodes.sort(
        (first, second) =>
          score(first) - score(second) ||
          first.order - second.order ||
          first.code.localeCompare(second.code) ||
          first.id.localeCompare(second.id),
      )
      nodes.forEach((node, index) =>
        order.set(node.id, (index + 0.5) / nodes.length),
      )
      return { rank, nodes, wrap: 0 }
    })
}
function placeRows(rows: Row[], width: number): Map<string, Position> {
  const positions = new Map<string, Position>()
  let top = 50
  rows.forEach((row, index) => {
    const span = row.nodes.length * 256 - 48
    row.nodes.forEach((node, column) => {
      const size = editorSize(node)
      positions.set(node.id, {
        x: (width - span) / 2 + column * 256 + size.width / 2,
        y: top,
        labelWidth: size.width,
        labelHeight: size.height,
        lines: [],
        rank: row.rank,
        row: index,
        labelTop: top,
        bottom: top + size.height,
      })
    })
    top += Math.max(...row.nodes.map((node) => editorSize(node).height)) + 100
  })
  return positions
}
function groupsFor(document: GraphDocument): Group[] {
  return document.nodes.flatMap((node) => {
    const targets = document.edges
      .filter((edge) => edge.source === node.id)
      .map((edge) => edge.target)
    return targets.length ? [{ sources: [node.id], targets }] : []
  })
}
export function arrange(original: unknown): Promise<GraphDocument> {
  const document = validate(original)
  if (!document.nodes.length) return Promise.resolve(document)
  const rows = orderedRows(document)
  const width = Math.max(...rows.map((row) => row.nodes.length)) * 256 + 100
  const positions = placeRows(rows, width)
  alignBranches(rows, positions, groupsFor(document), width, 0)
  document.nodes = document.nodes.map((node) => {
    const position = required(positions.get(node.id))
    return {
      ...node,
      position: {
        x: Math.round(position.x - editorSize(node).width / 2),
        y: position.y,
      },
    }
  })
  return Promise.resolve(document)
}
