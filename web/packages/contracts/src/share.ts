/**
 * @fileoverview 大屏发布态与匿名可读的公开视图。
 */
import type { DashboardNodeView } from './dashboard'

/**
 * 一张屏的发布态。
 * ⚠ 每次发布都换一个新令牌：取消发布再发布必须让旧链接失效，否则「撤回」是假的。
 */
export interface DashboardPublication {
  dashboardId: string
  isPublic: boolean
  /** 未公开时为 null。 */
  publicToken: string | null
}

/**
 * 按公开令牌匿名读到的一张屏，只有渲染要用的字段。
 *
 * ⚠ 这里**没有 `id`**，也没有 `projectId` / `rowVersion`：公开面不回任何能定位
 * 它在库里位置的信息（ADR-0014）。要一个稳定键时用令牌本身。
 */
export interface PublicDashboardPayload {
  name: string
  description: string | null
  designWidth: number
  designHeight: number
  schemaVersion: number
  themeJson: Record<string, unknown>
  chromeJson: Record<string, unknown>
  /**
   * 这份快照的数据截止时刻。
   * ⚠ 公开页**不接实时推送**，页面必须把这个时刻显示出来（ADR-0014 四）——
   * 一个看起来在跑、实际停在某一刻的大屏比明说自己是快照的危险得多。
   */
  updatedAt: string
  /** 扁平一维数组，树由 `parentId` 重建。比登录态窄，见 `DashboardNodeView`。 */
  nodes: DashboardNodeView[]
}
