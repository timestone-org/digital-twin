/**
 * @fileoverview 大屏缩略图的读写。图由前端截好、以 data URL 整个存上去。
 */
import type { DashboardThumbnail } from '@dt/contracts'

import { BizError, requestData } from './client'
import { onPlatform } from './dashboard'
import type { DashboardThumbnailWire } from './dashboardThumbnailWire'
import { toThumbnail } from './dashboardThumbnailWire'

/**
 * 这张屏还没存过缩略图（领域 10）。
 * ⚠ 按码分支，不按 message：文案会改、会翻译。
 */
export const THUMBNAIL_NOT_FOUND_CODE = 41017

/** data URL 超过服务端上限，HTTP 413。截图前调低分辨率或改用 JPEG。 */
export const THUMBNAIL_TOO_LARGE_CODE = 41018

/**
 * 读一张屏的缩略图；没存过时给 null，调用方据此显示占位图。
 * ⚠ 只把 404 收成 null：403 与 5xx 必须继续往上抛，否则「没权限看」会显示成
 * 「还没截过图」，用户永远等不到那张图也看不到原因。
 * @param dashboardId 大屏 id
 */
export async function getDashboardThumbnail(
  dashboardId: string,
): Promise<DashboardThumbnail | null> {
  try {
    const wire = await requestData<DashboardThumbnailWire>(
      `/dashboards/${dashboardId}/thumbnail`,
      onPlatform(),
    )
    return toThumbnail(wire)
  } catch (error) {
    if (error instanceof BizError && error.status === 404) return null
    throw error
  }
}

/**
 * 覆盖一张屏的缩略图。整份替换，故不需要幂等键。
 * @param dashboardId 大屏 id
 * @param dataUrl 截图的 data URL
 */
export async function saveDashboardThumbnail(
  dashboardId: string,
  dataUrl: string,
): Promise<DashboardThumbnail> {
  const wire = await requestData<DashboardThumbnailWire>(
    `/dashboards/${dashboardId}/thumbnail`,
    onPlatform({ method: 'PUT', body: { data: dataUrl } }),
  )
  return toThumbnail(wire)
}
