/**
 * @fileoverview 连线规则：契约是否相符、落点归一、自动选口、连接前置校验。
 *
 * ⚠ 校验放在**连线手势结束的那一刻**，不是等运行时才报：长流水线里一个笔误
 * 要跑到那一步才炸，而那时用户已经等了几十秒（MODELING_DESIGN §8.2）。
 * ⚠ 松手落在卡片上也算数：只认那个十来像素的圆点的话，用户得瞄准一个比光标
 * 大不了多少的靶子，十次里落空七次——现象与「连线根本用不了」无从区分。
 */
import type {
  ModelingGraph,
  ModelingGraphEdge,
  ModelingOperator,
} from '@dt/contracts'

import type { WireEnd } from './portHits'
import { nodeIdOf, portHitOf } from './portHits'

type Side = 'in' | 'out'
type Operators = ReadonlyMap<string, ModelingOperator>

/** 一次连接尝试的结论。不合法时 `reason` 是给用户看的人话。 */
export interface WireVerdict {
  ok: boolean
  reason: string
}

/** 一个口的数据契约。认不出这个口时给 null。 */
export function contractOf(
  graph: ModelingGraph,
  operators: Operators,
  at: WireEnd,
): string | null {
  const node = graph.nodes.find((item) => item.id === at.node)
  const spec = node === undefined ? undefined : operators.get(node.operator)
  const ports = at.side === 'in' ? spec?.inputs : spec?.outputs
  return ports?.find((item) => item.name === at.port)?.contract ?? null
}

/** 这个入口已经接了线吗。出口可以一对多，不受此限。 */
function isTaken(graph: ModelingGraph, at: WireEnd): boolean {
  if (at.side !== 'in') return false
  return graph.edges.some(
    (edge) => edge.to_node === at.node && edge.to_port === at.port,
  )
}

/**
 * 落在某张卡片上时替用户选一个口：契约相符、还空着、排在最前的那个。
 *
 * @param source 手势起点那一端
 * @param nodeId 松手落在的那张卡片
 */
export function autoEndOf(
  graph: ModelingGraph,
  operators: Operators,
  source: WireEnd,
  nodeId: string,
): WireEnd | null {
  const wanted = contractOf(graph, operators, source)
  const node = graph.nodes.find((item) => item.id === nodeId)
  const spec = node === undefined ? undefined : operators.get(node.operator)
  const side: Side = source.side === 'out' ? 'in' : 'out'
  const ports = (side === 'in' ? spec?.inputs : spec?.outputs) ?? []
  for (const port of ports) {
    const end: WireEnd = { node: nodeId, port: port.name, side }
    if (port.contract === wanted && !isTaken(graph, end)) return end
  }
  return null
}

/**
 * 松手落在哪一端上：先认接点，认不出再退到整张卡片替用户选口。
 *
 * @param source 手势起点那一端
 * @param element 松手时指针底下的元素
 */
export function dropEndOf(
  graph: ModelingGraph,
  operators: Operators,
  source: WireEnd,
  element: HTMLElement | null,
): WireEnd | null {
  const hit = portHitOf(element)
  if (hit !== null) return hit
  const nodeId = nodeIdOf(element)
  if (nodeId === null || nodeId === source.node) return null
  return autoEndOf(graph, operators, source, nodeId)
}

/**
 * 把两端归一成「出口 → 入口」。
 *
 * ⚠ 从入口反着往回拉也要认：只支持一个方向的话，用户接第二个输入时得先绕到
 * 上游那张卡片上去起手，而两张卡片往往不在同一屏里。
 */
export function orderEnds(
  from: WireEnd,
  to: WireEnd,
): { out: WireEnd; into: WireEnd } | null {
  if (from.side === 'out' && to.side === 'in') return { out: from, into: to }
  if (from.side === 'in' && to.side === 'out') return { out: to, into: from }
  return null
}

/**
 * 这条线能不能连。
 *
 * ⚠ 四条判据缺一不可：接到自己身上、契约不等、输入口已经被占、以及成环。
 * 参考实现零前置校验，全部错误都要等运行时才知道。
 */
export function verdictOf(
  graph: ModelingGraph,
  operators: Operators,
  out: WireEnd,
  into: WireEnd,
): WireVerdict {
  if (out.node === into.node) return { ok: false, reason: '不能接到自己身上' }
  const source = contractOf(graph, operators, out)
  const target = contractOf(graph, operators, into)
  if (source === null || target === null) {
    return { ok: false, reason: '这个接点不存在' }
  }
  if (source !== target) {
    return { ok: false, reason: '这两个口的数据类型对不上' }
  }
  if (isTaken(graph, into)) {
    return { ok: false, reason: '这个入口已经接了一条线' }
  }
  if (reaches(graph, into.node, out.node)) {
    return { ok: false, reason: '这样连会绕成一个环' }
  }
  return { ok: true, reason: '' }
}

/** 从起点拉过来的线，能不能接在这个口上。拉线期间照它给端口染色。 */
export function isReachableFrom(
  graph: ModelingGraph,
  operators: Operators,
  source: WireEnd | null,
  target: WireEnd,
): boolean {
  if (source === null) return false
  const ends = orderEnds(source, target)
  if (ends === null) return false
  return verdictOf(graph, operators, ends.out, ends.into).ok
}

/** 造一条新边。id 由两端拼出来，天然唯一且可读。 */
export function edgeOf(out: WireEnd, into: WireEnd): ModelingGraphEdge {
  return {
    id: `${out.node}:${out.port}->${into.node}:${into.port}`,
    from_node: out.node,
    from_port: out.port,
    to_node: into.node,
    to_port: into.port,
  }
}

/** 从 `start` 顺着边走，够不够得到 `target`。够得到就说明会成环。 */
function reaches(graph: ModelingGraph, start: string, target: string): boolean {
  const seen = new Set<string>()
  const queue = [start]
  while (queue.length > 0) {
    const current = queue.pop()
    if (current === undefined || seen.has(current)) continue
    if (current === target) return true
    seen.add(current)
    for (const edge of graph.edges) {
      if (edge.from_node === current) queue.push(edge.to_node)
    }
  }
  return false
}
