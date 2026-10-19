/** @fileoverview 标准图各展示行的位置与垂直走线空间。 */
import { railPlan } from './diagramRails'
import { wrapRows } from './diagramRows'
import type { Group, Metrics, Position, Row } from './diagramTypes'
import { GAP, MARGIN, TRACK } from './diagramTypes'
import { required } from './required'
import type { Drawing, GraphDocument } from './types'

export function prepare(
  document: GraphDocument,
  depth: Map<string, number>,
  groups: Group[],
  metrics: Map<string, Metrics>,
) {
  let gutter = 0,
    rows = wrapRows(document, depth, metrics, gutter, groups),
    plan = railPlan(rows, groups)
  for (;;) {
    const needed = plan.count ? 24 + plan.count * TRACK : 0
    if (needed <= gutter) break
    gutter = needed
    rows = wrapRows(document, depth, metrics, gutter, groups)
    plan = railPlan(rows, groups)
  }
  const incoming = rows.map((): number[] => []),
    outgoing = rows.map((): number[] => [])
  groups.forEach((group, index) => {
    for (const row of new Set(
      group.targets.map((id) => required(plan.rowOf.get(id))),
    ))
      required(incoming[row]).push(index)
    if (plan.lanes.has(index))
      for (const row of new Set(
        group.sources.map((id) => required(plan.rowOf.get(id))),
      ))
        required(outgoing[row]).push(index)
  })
  return {
    document,
    groups,
    metrics,
    gutter,
    rows,
    plan,
    incoming,
    outgoing,
    positions: new Map<string, Position>(),
    summary: [] as Drawing['rows'],
    bottoms: [] as number[],
    centers: [] as number[],
  }
}
export type Placement = ReturnType<typeof prepare>

function rowHorizontal(state: Placement, row: Row) {
  const wrapped = state.rows.some((peer) => peer.rank === row.rank && peer.wrap)
  const available = state.document.paper.width - 2 * MARGIN - state.gutter
  const widths = row.nodes.map(
    (node) => required(state.metrics.get(node.id)).labelWidth,
  )
  const used =
    widths.reduce((sum, width) => sum + width, 0) + GAP * (row.nodes.length - 1)
  const gap = wrapped
    ? GAP
    : row.nodes.length > 1
      ? Math.min(64, GAP + (available - used) / (row.nodes.length - 1))
      : 0
  const span =
    widths.reduce((sum, width) => sum + width, 0) + gap * (row.nodes.length - 1)
  let x = MARGIN + (available - span) / 2
  if (wrapped) {
    const columns = Math.max(
      ...state.rows
        .filter((peer) => peer.rank === row.rank)
        .map((peer) => peer.nodes.length),
    )
    const width = required(widths[0]),
      grid = columns * width + (columns - 1) * GAP
    x =
      MARGIN +
      (available - grid) / 2 +
      (row.wrap % 2 ? (columns - row.nodes.length) * (width + GAP) : 0)
  }
  return { x, gap }
}

function rowCenter(state: Placement, index: number, previous: number): number {
  if (!index) return previous
  const outgoing = required(state.outgoing[index - 1])
  const exitSpace = outgoing.length
    ? 16 + (outgoing.length - 1) * TRACK + 20
    : 0
  return Math.max(
    previous + 239,
    required(state.bottoms[index - 1]) +
      exitSpace +
      85 +
      Math.max(0, required(state.incoming[index]).length - 1) * TRACK,
  )
}

function placeRow(state: Placement, row: Row, index: number, center: number) {
  const horizontal = rowHorizontal(state, row)
  let x = horizontal.x
  const ordered = row.wrap % 2 ? [...row.nodes].reverse() : row.nodes
  for (const node of ordered) {
    const metrics = required(state.metrics.get(node.id)),
      labelTop = center + (row.rank === 0 ? 80 : 85)
    state.positions.set(node.id, {
      ...metrics,
      x: x + metrics.labelWidth / 2,
      y: center,
      rank: row.rank,
      row: index,
      labelTop,
      bottom: labelTop + metrics.labelHeight,
    })
    x += metrics.labelWidth + horizontal.gap
  }
  state.centers.push(center)
  state.bottoms.push(
    Math.max(
      ...row.nodes.map((node) => required(state.positions.get(node.id)).bottom),
    ),
  )
  state.summary.push({
    rank: row.rank,
    row: index,
    centerY: center,
    count: row.nodes.length,
  })
}
export function placeRows(state: Placement) {
  let center = 79
  state.rows.forEach((row, index) => {
    center = rowCenter(state, index, center)
    placeRow(state, row, index, center)
  })
}
