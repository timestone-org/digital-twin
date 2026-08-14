/**
 * @fileoverview 大屏缩略图：客户端截的图，一屏一张。
 */

/** 一张屏的缩略图。 */
export interface DashboardThumbnail {
  dashboardId: string
  /** 截图的 data URL。 */
  data: string
  updatedAt: string
}
