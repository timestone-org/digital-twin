/**
 * @fileoverview 指针落在了画布上的什么东西上：接点，还是整张卡片。
 *
 * 只做 DOM 命中，不认识图也不认识算子——连线规则在 `useCanvasWiring.ts`。
 */

/** 接点在 DOM 上的三个标记，命中测试只认它们。 */
export const PORT_NODE_ATTR = 'data-port-node'
export const PORT_NAME_ATTR = 'data-port-name'
export const PORT_SIDE_ATTR = 'data-port-side'
/** 整张卡片上的标记，用来接住「落在卡片上但没落在接点上」的那一下。 */
export const NODE_ID_ATTR = 'data-node-id'

/** 一条线的一端：哪个节点的哪个口，在哪一侧。 */
export interface WireEnd {
  node: string
  port: string
  side: 'in' | 'out'
}

/** 从松手时的 DOM 元素上找出接点。没落在接点上给 null。 */
export function portHitOf(element: HTMLElement | null): WireEnd | null {
  const host = element?.closest(`[${PORT_NODE_ATTR}]`)
  if (!(host instanceof HTMLElement)) return null
  const node = host.getAttribute(PORT_NODE_ATTR)
  const port = host.getAttribute(PORT_NAME_ATTR)
  const side = host.getAttribute(PORT_SIDE_ATTR)
  if (node === null || port === null) return null
  return { node, port, side: side === 'in' ? 'in' : 'out' }
}

/** 从松手时的 DOM 元素上找出它落在哪张卡片上。 */
export function nodeIdOf(element: HTMLElement | null): string | null {
  const host = element?.closest(`[${NODE_ID_ATTR}]`)
  if (!(host instanceof HTMLElement)) return null
  return host.getAttribute(NODE_ID_ATTR)
}
