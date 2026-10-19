/** @fileoverview 汇流线顺序的交叉代价最小化。 */
import type { Group, Position } from './diagramTypes'
import { required } from './required'
interface HeaderInfo {
  sources: { id: string; x: number }[]
  targets: { id: string; x: number }[]
  left: number
  right: number
}
export interface HeaderContext {
  positions: Map<string, Position>
  lanes: Map<number, number>
  railX: (index: number) => number
}
function crossingCost(info: Map<number, HeaderInfo>) {
  const costs = new Map<string, number>()
  const cost = (top: number, bottom: number) => {
    const key = `${top}:${bottom}`
    if (costs.has(key)) return required(costs.get(key))
    const a = required(info.get(top)),
      b = required(info.get(bottom))
    const value =
      b.sources.filter(
        (p) =>
          p.x >= a.left &&
          p.x <= a.right &&
          !a.sources.some((q) => p.id === q.id),
      ).length +
      a.targets.filter(
        (p) =>
          p.x >= b.left &&
          p.x <= b.right &&
          !b.targets.some((q) => p.id === q.id),
      ).length
    costs.set(key, value)
    return value
  }

  return cost
}
function sortHeaders(
  ids: number[],
  cost: (top: number, bottom: number) => number,
): number[] {
  const result: number[] = []
  for (const id of ids) {
    let value = result.reduce((sum, other) => sum + cost(other, id), 0)
    let bestScore = value,
      bestPosition = result.length
    for (let i = result.length - 1; i >= 0; i--) {
      value += cost(id, required(result[i])) - cost(required(result[i]), id)
      if (value < bestScore) {
        bestPosition = i
        bestScore = value
      }
    }
    result.splice(bestPosition, 0, id)
  }
  for (let pass = 0; pass < result.length; pass++) {
    let changed = false
    for (let i = 1; i < result.length; i++)
      if (
        cost(required(result[i]), required(result[i - 1])) <
        cost(required(result[i - 1]), required(result[i]))
      ) {
        ;[result[i - 1], result[i]] = [
          required(result[i]),
          required(result[i - 1]),
        ]
        changed = true
      }
    if (!changed) break
  }
  return result
}
export function orderHeaders(
  ids: number[],
  row: number,
  groups: Group[],
  context: HeaderContext,
): number[] {
  const { positions, lanes, railX } = context
  const info = new Map(
    ids.map((id) => {
      const sources = lanes.has(id)
        ? []
        : required(groups[id]).sources.map((n) => ({
            id: n,
            x: required(positions.get(n)).x,
          }))
      const targets = required(groups[id])
        .targets.filter((n) => required(positions.get(n)).row === row)
        .map((n) => ({ id: n, x: required(positions.get(n)).x }))
      const xs = [...sources, ...targets].map((p) => p.x)
      if (lanes.has(id)) xs.push(railX(id))
      return [
        id,
        { sources, targets, left: Math.min(...xs), right: Math.max(...xs) },
      ]
    }),
  )
  return sortHeaders(ids, crossingCost(info))
}
