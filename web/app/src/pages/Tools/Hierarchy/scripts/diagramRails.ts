/** @fileoverview 跨展示行连接的侧通道分配。 */
import type { Group, Row } from './diagramTypes'
import { required } from './required'
export function railPlan(rows: Row[], groups: Group[]) {
  const rowOf = new Map(
    rows.flatMap((r, i) => r.nodes.map((n) => [n.id, i] as const)),
  )
  const spans = groups
    .map((g, index) => ({
      index,
      start: Math.min(...g.sources.map((id) => required(rowOf.get(id)))),
      end: Math.max(...g.targets.map((id) => required(rowOf.get(id)))),
      simple:
        new Set(g.sources.map((id) => rowOf.get(id))).size === 1 &&
        new Set(g.targets.map((id) => rowOf.get(id))).size === 1 &&
        required(rowOf.get(required(g.targets[0]))) ===
          required(rowOf.get(required(g.sources[0]))) + 1,
    }))
    .filter((s) => !s.simple)
    .sort((a, b) => a.start - b.start || b.end - a.end || a.index - b.index)
  const ends: number[] = [],
    lanes = new Map<number, number>()
  for (const span of spans) {
    let lane = ends.findIndex((end) => end < span.start)
    if (lane < 0) lane = ends.length
    ends[lane] = span.end
    lanes.set(span.index, lane)
  }
  return { lanes, count: ends.length, rowOf }
}
