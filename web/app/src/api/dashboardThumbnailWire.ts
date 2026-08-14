/**
 * @fileoverview 缩略图出参的线形与它到载荷的映射。
 */
import type { DashboardThumbnail } from '@dt/contracts'

export interface DashboardThumbnailWire {
  dashboard_id: string
  data: string
  updated_at: string
}

/**
 * 一张缩略图的载荷。
 * @param wire 线上的缩略图
 */
export function toThumbnail(wire: DashboardThumbnailWire): DashboardThumbnail {
  return {
    dashboardId: wire.dashboard_id,
    data: wire.data,
    updatedAt: wire.updated_at,
  }
}
