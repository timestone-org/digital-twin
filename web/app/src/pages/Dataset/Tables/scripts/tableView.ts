/**
 * @fileoverview 台账列表上那几格的取值口径：关键字匹配与保留期。
 *
 * 取数方式那一格在 `../../scripts/collectSummary.ts`——详情页也要它。
 */

import type { DatasetTableSummary } from '@dt/contracts'

/**
 * 这一行是不是命中了关键字。按名称与编码两处匹配，与后端 `?q=` 同口径。
 * @param table 一行台账
 * @param keyword 搜索词，空串即不过滤
 */
export function matchesKeyword(
  table: DatasetTableSummary,
  keyword: string,
): boolean {
  const needle = keyword.trim().toLowerCase()
  if (needle === '') return true
  return (
    table.name.toLowerCase().includes(needle) ||
    table.code.toLowerCase().includes(needle)
  )
}

/**
 * 保留期那一格。
 * @param retentionDays 保留天数，null = 永久
 */
export function retentionLabel(retentionDays: number | null): string {
  return retentionDays === null ? '永久' : `${retentionDays} 天`
}
