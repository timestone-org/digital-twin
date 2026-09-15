/** @fileoverview 当前账号的点位语义搜索。 */
import type {
  CollectPoint,
  PointMatchOut,
  PointMatchesOut,
} from '@dt/contracts'
import { PLATFORM_BASE_URL } from '@/config/app'
import { BizError, requestData } from './client'
import { listPoints } from './collect'

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

/** 按候选的稳定身份读取完整配置，避免将相似编码写入绑定。 */
export async function resolveCollectPoint(
  match: PointMatchOut,
  signal: AbortSignal,
): Promise<CollectPoint> {
  let page = 1
  while (true) {
    signal.throwIfAborted()
    const result = await listPoints(
      { sourceId: match.source_id, q: match.code, page, size: 200 },
      signal,
    )
    signal.throwIfAborted()
    const point = result.items.find(
      (one) => one.id === match.id && one.node_key === match.node_key,
    )
    if (point) return point
    if (result.items.length === 0 || page * result.size >= result.total) break
    page += 1
  }
  throw new BizError(41102, '点位已不存在，请重新搜索', 404, '')
}
