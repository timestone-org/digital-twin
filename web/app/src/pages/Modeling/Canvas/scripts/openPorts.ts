/**
 * @fileoverview 拉线期间「哪些口还接得住」的一张表，卡片照它给接点染色。
 *
 * ⚠ 逐口真判一次而不是只比契约：入口被占、会绕成环这两种也得当场看得出来，
 * 否则用户会一路拖过去、松手才被拒，而那时他已经忘了自己是从哪个口起的手。
 */
import type { ModelingGraph, ModelingOperator } from '@dt/contracts'

import type { WireEnd } from './portHits'
import { isReachableFrom } from './useCanvasWiring'

/** 一个口在这张表里的键。 */
export function portKey(side: 'in' | 'out', name: string): string {
  return `${side}:${name}`
}

/**
 * 每张卡片上还接得住的那些口。没在拉线时给一张空表。
 *
 * @param from 手势起点那一端；没在拉线时给 null
 */
function openOn(
  graph: ModelingGraph,
  operators: ReadonlyMap<string, ModelingOperator>,
  from: WireEnd,
  nodeId: string,
): Set<string> {
  const node = graph.nodes.find((item) => item.id === nodeId)
  const spec = node === undefined ? undefined : operators.get(node.operator)
  const open = new Set<string>()
  const sides: ['in' | 'out', readonly { name: string }[]][] = [
    ['in', spec?.inputs ?? []],
    ['out', spec?.outputs ?? []],
  ]
  for (const [side, ports] of sides) {
    for (const port of ports) {
      const end: WireEnd = { node: nodeId, port: port.name, side }
      if (isReachableFrom(graph, operators, from, end)) {
        open.add(portKey(side, port.name))
      }
    }
  }
  return open
}

export function openPortsOf(
  graph: ModelingGraph,
  operators: ReadonlyMap<string, ModelingOperator>,
  from: WireEnd | null,
): Map<string, ReadonlySet<string>> {
  const table = new Map<string, ReadonlySet<string>>()
  if (from === null) return table
  for (const node of graph.nodes) {
    table.set(node.id, openOn(graph, operators, from, node.id))
  }
  return table
}
