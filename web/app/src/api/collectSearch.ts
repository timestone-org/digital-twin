/** @fileoverview 当前账号的点位语义搜索。 */
import type { PointMatchesOut } from '@dt/contracts'
import { PLATFORM_BASE_URL } from '@/config/app'
import { requestData } from './client'

export function searchCollectPoints(
  query: string,
  sourceId?: string,
  signal?: AbortSignal,
): Promise<PointMatchesOut> {
  return requestData<PointMatchesOut>('/collect-point-matches', {
    baseUrl: PLATFORM_BASE_URL,
    query: { q: query, source_id: sourceId, limit: 6 },
    signal,
  })
}
