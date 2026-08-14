/**
 * @fileoverview 历史序列（`archive`）来源的 provider：走应用壳注入的取数函数
 * （它要读登录态与超时口径，那在应用壳里）。
 * ⚠ 失败一律拒绝并说明原因，绝不返回空 `points` 冒充「这段时间没数据」
 * （docs/DASHBOARD_DESIGN.md §4.3）。
 */
import type {
  DataSourceProvider,
  HistoryQuery,
  HistoryResult,
} from '@dt/contracts'

import { refuseSubscribe } from '../capability'
import { DataSourceError, describeError, isDataSourceError } from '../errors'

const KIND = 'archive'

/** 应用壳注入的口子。 */
export interface HistoryPorts {
  /** 真去后端取一段序列；失败必须抛，不许拿空序列兜底。 */
  fetchHistory: (query: HistoryQuery) => Promise<HistoryResult>
}

/**
 * 造一个历史序列 provider。
 * @param ports 应用壳注入的取数函数
 */
export function createHistoryProvider(ports: HistoryPorts): DataSourceProvider {
  return {
    kind: KIND,
    subscribe: (nodeKeys) => refuseSubscribe(KIND, nodeKeys),
    readHistory: (query) => readHistory(ports, query),
  }
}

async function readHistory(
  ports: HistoryPorts,
  query: HistoryQuery,
): Promise<HistoryResult> {
  assertQuery(query)
  try {
    return await ports.fetchHistory(query)
  } catch (error) {
    if (isDataSourceError(error)) throw error
    throw new DataSourceError(
      'fetch-failed',
      `历史取数失败：${describeError(error)}`,
      { cause: error },
    )
  }
}

/** 自相矛盾的取数条件当场说破，别拿它去问后端再收一份空结果。 */
function assertQuery(query: HistoryQuery): void {
  if (query.nodeKey.trim() === '') {
    throw new DataSourceError('invalid-query', '历史取数缺少点位身份')
  }
  assertRange(query)
}

function assertRange(query: HistoryQuery): void {
  const { fromMs, toMs, limit } = query.range
  // ⚠ 左右颠倒的时间窗后端只会回一段空序列，那与「这段时间没数据」长得一样
  if (fromMs !== undefined && toMs !== undefined && fromMs > toMs) {
    throw new DataSourceError(
      'invalid-query',
      `历史取数的时间窗左右颠倒：${fromMs} > ${toMs}`,
    )
  }
  if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) {
    throw new DataSourceError(
      'invalid-query',
      `历史取数的 limit 必须是正整数，收到 ${limit}`,
    )
  }
}
