/**
 * @fileoverview 历史类取数（归档、台账）共用的时间窗与条数校验。
 */
import type { HistoryQuery } from '@dt/contracts'

import { DataSourceError } from './errors'

/**
 * 时间窗左右颠倒或 limit 不是正整数就拒绝。
 * @param query 取数请求
 * @param label 报错里的来源名，如「历史取数」
 */
export function assertRange(query: HistoryQuery, label: string): void {
  const { fromMs, toMs, limit } = query.range
  // ⚠ 左右颠倒的时间窗后端只会回一段空序列，那与「这段时间没数据」长得一样
  if (fromMs !== undefined && toMs !== undefined && fromMs > toMs) {
    throw new DataSourceError(
      'invalid-query',
      `${label}的时间窗左右颠倒：${fromMs} > ${toMs}`,
    )
  }
  if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) {
    throw new DataSourceError(
      'invalid-query',
      `${label}的 limit 必须是正整数，收到 ${limit}`,
    )
  }
}
