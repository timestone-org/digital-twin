/**
 * @fileoverview 选中集的纯操作：末位是主选中；toggle 累积、set 去重防幽灵、
 * prune 随节点表收敛。
 */
import type { DashboardNodePayload } from '@dt/contracts'

/** Shift 点击：在集合里就移出，不在就追加为主选中。 */
export function toggledSelection(
  selection: readonly string[],
  nodeId: string,
): readonly string[] {
  return selection.includes(nodeId)
    ? selection.filter((id) => id !== nodeId)
    : [...selection, nodeId]
}

/** 整体换选中集：不存在的 id 剔除、重复保首个出现位。 */
export function sanitizedSelection(
  nodeIds: readonly string[],
  nodes: readonly DashboardNodePayload[],
): readonly string[] {
  const alive = new Set(nodes.map((node) => node.id))
  const seen = new Set<string>()
  const next: string[] = []
  for (const id of nodeIds) {
    if (alive.has(id) && !seen.has(id)) {
      seen.add(id)
      next.push(id)
    }
  }
  return next
}

/** 节点表变化后收敛选中集；一项没少时返回原引用，免得触发无谓重算。 */
export function prunedSelection(
  selection: readonly string[],
  nodes: readonly DashboardNodePayload[],
): readonly string[] {
  const alive = new Set(nodes.map((node) => node.id))
  const kept = selection.filter((id) => alive.has(id))
  return kept.length === selection.length ? selection : kept
}
