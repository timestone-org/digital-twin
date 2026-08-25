/**
 * @fileoverview 节点入场的错峰延迟：按视觉序（上到下、左到右）排队，每格错开一拍。
 * 纯计算，动画本体在 NodeTree 的样式里。
 */
import type { RuntimeNode } from './nodeTree'

/** 相邻两格的错峰间隔。 */
export const ENTER_STAGGER_MS = 45
/**
 * 错峰封顶的格数：超过的一律与最后一档同时出现。
 * ⚠ 不封顶的话，几十个模块的大屏最后几格要干等两三秒才露面。
 */
export const MAX_STAGGERED_NODES = 12

/**
 * 本层每个节点的入场延迟（毫秒）。
 * 排队按几何位置而不是渲染序：渲染序跟着 zIndex 走，观众看到的却是版面，
 * 按版面自上而下扫过去才像「一屏逐块点亮」。
 * @param nodes 本层要挂载的节点
 * @param baseMs 起拍延迟；容器子层拿父格的延迟当基点接力
 */
export function entranceDelays(
  nodes: readonly RuntimeNode[],
  baseMs: number,
): ReadonlyMap<string, number> {
  const ordered = [...nodes].sort(
    (a, b) => a.box.y - b.box.y || a.box.x - b.box.x || (a.id < b.id ? -1 : 1),
  )
  const delays = new Map<string, number>()
  ordered.forEach((node, index) => {
    const step = Math.min(index, MAX_STAGGERED_NODES)
    delays.set(node.id, baseMs + step * ENTER_STAGGER_MS)
  })
  return delays
}
