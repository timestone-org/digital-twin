/**
 * @fileoverview 连线：接点命中、连接前置校验、边的几何。
 *
 * ⚠ 校验放在**连线手势结束的那一刻**，不是等运行时才报：长流水线里一个笔误
 * 要跑到那一步才炸，而那时用户已经等了几十秒（MODELING_DESIGN §8.2）。
 */
import type {
  ModelingGraph,
  ModelingGraphEdge,
  ModelingOperator,
} from '@dt/contracts'

import type { CanvasPoint } from './useCanvasViewport'

/** 接点在 DOM 上的两个标记，命中测试只认它们。 */
export const PORT_NODE_ATTR = 'data-port-node'
export const PORT_NAME_ATTR = 'data-port-name'
export const PORT_SIDE_ATTR = 'data-port-side'

/** 贝塞尔的水平控制点距离（画布像素）。 */
const CURVE_TENSION = 60

/** 松手时落在的那个接点。 */
export interface PortHit {
  node: string
  port: string
  side: 'in' | 'out'
}

/** 一次连接尝试的结论。不合法时 `reason` 是给用户看的人话。 */
export interface WireVerdict {
  ok: boolean
  reason: string
}

/** 从松手时的 DOM 元素上找出接点。没落在接点上给 null。 */
export function portHitOf(element: HTMLElement | null): PortHit | null {
  const host = element?.closest(`[${PORT_NODE_ATTR}]`)
  if (!(host instanceof HTMLElement)) return null
  const node = host.getAttribute(PORT_NODE_ATTR)
  const port = host.getAttribute(PORT_NAME_ATTR)
  const side = host.getAttribute(PORT_SIDE_ATTR)
  if (node === null || port === null) return null
  return { node, port, side: side === 'in' ? 'in' : 'out' }
}

/**
 * 这条线能不能连。
 *
 * ⚠ 四条判据缺一不可：接到自己身上、契约不等、输入口已经被占、以及成环。
 * 参考实现零前置校验，全部错误都要等运行时才知道。
 */
export function verdictOf(
  graph: ModelingGraph,
  operators: ReadonlyMap<string, ModelingOperator>,
  from: { node: string; port: string },
  to: PortHit,
): WireVerdict {
  if (to.side !== 'in') return { ok: false, reason: '要接到下游的入口上' }
  if (from.node === to.node) return { ok: false, reason: '不能接到自己身上' }
  const out = portOf(operators, graph, from.node, from.port, 'out')
  const into = portOf(operators, graph, to.node, to.port, 'in')
  if (out === null || into === null) {
    return { ok: false, reason: '这个接点不存在' }
  }
  if (out !== into) {
    return { ok: false, reason: '这两个口的数据类型对不上' }
  }
  if (
    graph.edges.some(
      (edge) => edge.to_node === to.node && edge.to_port === to.port,
    )
  ) {
    return { ok: false, reason: '这个入口已经接了一条线' }
  }
  if (reaches(graph, to.node, from.node)) {
    return { ok: false, reason: '这样连会绕成一个环' }
  }
  return { ok: true, reason: '' }
}

/** 一条已经算好两端坐标的边，交给 SVG 那一层去画。 */
export interface DrawnEdge {
  id: string
  from: CanvasPoint
  to: CanvasPoint
}

/** 一条边的贝塞尔路径。两端都给画布坐标。 */
export function curveOf(from: CanvasPoint, to: CanvasPoint): string {
  const tension = Math.max(CURVE_TENSION, Math.abs(to.left - from.left) / 2)
  return [
    `M ${from.left} ${from.top}`,
    `C ${from.left + tension} ${from.top}`,
    `${to.left - tension} ${to.top}`,
    `${to.left} ${to.top}`,
  ].join(' ')
}

/** 造一条新边。id 由两端拼出来，天然唯一且可读。 */
export function edgeOf(
  from: { node: string; port: string },
  to: PortHit,
): ModelingGraphEdge {
  return {
    id: `${from.node}:${from.port}->${to.node}:${to.port}`,
    from_node: from.node,
    from_port: from.port,
    to_node: to.node,
    to_port: to.port,
  }
}

function portOf(
  operators: ReadonlyMap<string, ModelingOperator>,
  graph: ModelingGraph,
  nodeId: string,
  portName: string,
  side: 'in' | 'out',
): string | null {
  const node = graph.nodes.find((item) => item.id === nodeId)
  const spec = node === undefined ? undefined : operators.get(node.operator)
  const ports = side === 'in' ? spec?.inputs : spec?.outputs
  return ports?.find((item) => item.name === portName)?.contract ?? null
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
