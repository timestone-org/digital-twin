/**
 * @fileoverview 图层树眼睛的设计态显隐覆盖；生成画布专用节点，永远不写回
 * 持久化节点的「初始可见」。
 */
import type { DashboardNodePayload } from '@dt/contracts'

/** 翻转一个节点的设计态显隐，返回新集合供 Vue 按引用追踪。 */
export function toggleEditorNodeVisibility(
  hidden: ReadonlySet<string>,
  nodeId: string,
): ReadonlySet<string> {
  const next = new Set(hidden)
  if (!next.delete(nodeId)) next.add(nodeId)
  return next
}

/**
 * 生成只供图层树与设计画布使用的节点：默认全部显示，图层眼睛关掉的才隐藏。
 * @param nodes 持久化文档节点
 * @param hidden 图层眼睛关掉的节点 id
 */
export function withEditorNodeVisibility(
  nodes: readonly DashboardNodePayload[],
  hidden: ReadonlySet<string>,
): DashboardNodePayload[] {
  return nodes.map((node) => ({
    ...node,
    isVisible: !hidden.has(node.id),
  }))
}
