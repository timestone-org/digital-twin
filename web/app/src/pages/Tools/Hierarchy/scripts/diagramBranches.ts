/** @fileoverview 父节点靠近子分支并保持同层顺序与最小间距。 */
import type { Group, Position, Row } from './diagramTypes'
import { GAP, MARGIN } from './diagramTypes'
import { required } from './required'
import type { GraphNode } from './types'
function branchBlocks(
  ordered: GraphNode[],
  positions: Map<string, Position>,
  groups: Group[],
  step: number,
) {
  const blocks: {
    from: number
    to: number
    sum: number
    weight: number
  }[] = []
  ordered.forEach((node, i) => {
    const children = [
      ...new Set(
        groups
          .filter((g) => g.sources.includes(node.id))
          .flatMap((g) => g.targets),
      ),
    ].map((id) => required(positions.get(id)))
    const firstRow = Math.min(...children.map((p) => p.row)),
      nearest = children.filter((p) => p.row === firstRow)
    const desired = nearest.length
      ? (Math.min(...nearest.map((p) => p.x)) +
          Math.max(...nearest.map((p) => p.x))) /
        2
      : required(positions.get(node.id)).x
    const weight = nearest.length ? 4 : 0.25
    blocks.push({
      from: i,
      to: i,
      sum: (desired - i * step) * weight,
      weight,
    })
    while (blocks.length > 1) {
      const last = required(blocks.at(-1)),
        before = required(blocks.at(-2))
      if (before.sum / before.weight <= last.sum / last.weight) break
      blocks.splice(-2, 2, {
        from: before.from,
        to: last.to,
        sum: before.sum + last.sum,
        weight: before.weight + last.weight,
      })
    }
  })
  return blocks
}
function spreadBetweenAnchors(
  ordered: GraphNode[],
  positions: Map<string, Position>,
  groups: Group[],
) {
  const anchors = ordered
    .map((node, i) =>
      groups.some((g) => g.sources.includes(node.id)) ? i : -1,
    )
    .filter((i) => i >= 0)
  for (let a = 1; a < anchors.length; a++) {
    const left = required(anchors[a - 1]),
      right = required(anchors[a])
    const first = required(positions.get(required(ordered[left]).id)).x,
      last = required(positions.get(required(ordered[right]).id)).x
    for (let i = left + 1; i < right; i++)
      required(positions.get(required(ordered[i]).id)).x =
        first + ((last - first) * (i - left)) / (right - left)
  }
}
export function alignBranches(
  rows: Row[],
  positions: Map<string, Position>,
  groups: Group[],
  width: number,
  gutter: number,
) {
  const wrapped = new Set(rows.filter((row) => row.wrap).map((row) => row.rank))
  for (let rowIndex = rows.length - 1; rowIndex >= 0; rowIndex--) {
    const row = required(rows[rowIndex])
    if (wrapped.has(row.rank)) continue
    const ordered = [...row.nodes].sort(
      (a, b) =>
        required(positions.get(a.id)).x - required(positions.get(b.id)).x,
    )
    const frame = required(positions.get(required(ordered[0]).id)).labelWidth,
      step = frame + GAP
    const minimum = MARGIN + frame / 2,
      maximum =
        width - MARGIN - gutter - frame / 2 - (ordered.length - 1) * step
    const blocks = branchBlocks(ordered, positions, groups, step)
    for (const block of blocks) {
      const z = Math.max(minimum, Math.min(maximum, block.sum / block.weight))
      for (let i = block.from; i <= block.to; i++)
        required(positions.get(required(ordered[i]).id)).x = z + i * step
    }
    spreadBetweenAnchors(ordered, positions, groups)
  }
}
