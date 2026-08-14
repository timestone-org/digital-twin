/**
 * @fileoverview 弹窗要的几份派生视图：按项目分组的大屏、可覆盖目标、重名判定。
 * 都是纯函数，聚合组件里的 `computed` 只做一次调用。
 */
import type { DashboardSummary } from '@/api/dashboardWire'

/** 按项目 id 把大屏分组。新建大屏的「复制来源」按项目分节列。 */
export function groupByProject(
  items: readonly DashboardSummary[],
): Record<string, DashboardSummary[]> {
  const grouped: Record<string, DashboardSummary[]> = {}
  for (const item of items) (grouped[item.projectId] ??= []).push(item)
  return grouped
}

/** 导入时可被覆盖的目标。 */
export function toImportTargets(
  items: readonly DashboardSummary[],
): { id: string; name: string }[] {
  return items.map((item) => ({ id: item.id, name: item.name }))
}

/**
 * 项目内已有同名屏。
 * ⚠ 只是提示：项目内大屏名不唯一，重名照样建得出来。
 * @param items 项目下已有的屏
 * @param name 待用的名字；没有名字时一律判不重名
 */
export function hasNameClash(
  items: readonly DashboardSummary[],
  name: string | undefined,
): boolean {
  const trimmed = name?.trim()
  if (trimmed === undefined || trimmed === '') return false
  return items.some((item) => item.name.trim() === trimmed)
}
