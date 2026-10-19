/** @fileoverview 标准图分行、分支对齐和连接的单一编排入口。 */
import { alignBranches } from './diagramBranches'
import { connectRows } from './diagramConnections'
import { placeRows, prepare } from './diagramPlacement'
import type { Group, Metrics } from './diagramTypes'
import type { GraphDocument } from './types'
export type { Group, Point, Position, Segment } from './diagramTypes'

export function layoutDiagram(
  document: GraphDocument,
  depth: Map<string, number>,
  groups: Group[],
  metrics: Map<string, Metrics>,
) {
  const state = prepare(document, depth, groups, metrics)
  placeRows(state)
  alignBranches(
    state.rows,
    state.positions,
    groups,
    document.paper.width,
    state.gutter,
  )
  return {
    positions: state.positions,
    rows: state.summary,
    segments: connectRows(state),
    width: document.paper.width,
  }
}
