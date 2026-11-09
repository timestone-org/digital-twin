/** @fileoverview 翻完一个数据源下的全部点位：导出、撞码预检与已建索引共用这一份。 */
import type { CollectPoint } from '@dt/contracts'

import * as collect from '@/api/collect'

/** 一次取多少条。⚠ 与后端单页上限对齐，取大了会被 422。 */
const PAGE_SIZE = 100

/**
 * 逐页取完，取空页或凑满总数就停；中止信号在两页之间检查。
 * @param sourceId 数据源
 * @param signal 中止信号（切源、卸载时作废）
 */
export async function listAllPoints(
  sourceId: string,
  signal?: AbortSignal,
): Promise<CollectPoint[]> {
  const all: CollectPoint[] = []
  for (let page = 1; signal?.aborted !== true; page += 1) {
    const chunk = await collect.listPoints(
      { sourceId, page, size: PAGE_SIZE },
      signal,
    )
    all.push(...chunk.items)
    if (chunk.items.length === 0 || all.length >= chunk.total) break
  }
  return all
}
