/**
 * @fileoverview `dashboard-ref` 控件的候选来源：某个项目下的大屏列表，按项目缓存。
 * 一张大屏上可以有好几个这种字段，缓存放在模块作用域里让它们共用同一次请求。
 * ⚠ 失败**不留在缓存里**：一次网络或鉴权抖动会把「查不到」钉死整个会话，
 * 之后每个控件都拿着同一份空结果，且再也不会重试。
 */
import { listDashboards } from '@/api/dashboard'
import type { DashboardSummary } from '@/api/dashboardWire'

/** 一次拉多少张。够挑就行，属性面板里不做翻页。 */
const PAGE_SIZE = 100

const cache = new Map<string, Promise<DashboardSummary[]>>()

/**
 * 取某个项目下的大屏，同项目只拉一次。
 * @param projectId 项目 id
 */
export function loadProjectDashboards(
  projectId: string,
): Promise<DashboardSummary[]> {
  const hit = cache.get(projectId)
  if (hit !== undefined) return hit
  const pending = listDashboards({ projectId, page: 1, size: PAGE_SIZE })
    .then((page) => page.items)
    .catch((caught: unknown) => {
      cache.delete(projectId)
      throw caught
    })
  cache.set(projectId, pending)
  return pending
}

/** 丢掉全部缓存。大屏另存、改名之后重新挂载编辑器时用得上。 */
export function resetProjectDashboards(): void {
  cache.clear()
}
