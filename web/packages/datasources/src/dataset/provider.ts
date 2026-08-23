/**
 * @fileoverview 数据台账（`dataset`）来源的 provider：走应用壳注入的取数函数
 * （它要读登录态与超时口径，那在应用壳里）。
 *
 * ⚠ **台账没有可订阅的现值，故 `subscribe` 一律拒绝。** 台账的行是采集器按
 * 周期写出来的，不是一条推流；前端自己起一个轮询会是**假的推送**——它既复制了
 * 后端已有的脏信号机制（写入侧 SADD、发布器取走，见 docs/DATASET_DESIGN.md
 * §16），又按「每个看大屏的人一份」放大：十个人看同一张大屏就是十条轮询。
 * 要现值的模块该绑点位；台账列的实时化等发布器那条推送接通，不在这一层伪造。
 * ⚠ 取数失败一律拒绝并说明原因，绝不返回空 `points` 冒充「这段时间没数据」
 * （docs/DASHBOARD_DESIGN.md §4.3）。
 */
import type {
  DataSourceProvider,
  HistoryQuery,
  HistoryResult,
} from '@dt/contracts'
import { parseDatasetBindingKey } from '@dt/contracts'

import { refuseSubscribe } from '../capability'
import { DataSourceError, describeError, isDataSourceError } from '../errors'

const KIND = 'dataset'

/** 应用壳注入的口子。 */
export interface DatasetPorts {
  /** 真去后端取一段台账序列；失败必须抛，不许拿空序列兜底。 */
  fetchSeries: (query: HistoryQuery) => Promise<HistoryResult>
}

/**
 * 造一个台账序列 provider。
 * @param ports 应用壳注入的取数函数
 */
export function createDatasetProvider(ports: DatasetPorts): DataSourceProvider {
  return {
    kind: KIND,
    subscribe: (nodeKeys) => refuseSubscribe(KIND, nodeKeys),
    readHistory: (query) => readHistory(ports, query),
  }
}

async function readHistory(
  ports: DatasetPorts,
  query: HistoryQuery,
): Promise<HistoryResult> {
  assertQuery(query)
  try {
    return await ports.fetchSeries(query)
  } catch (error) {
    if (isDataSourceError(error)) throw error
    throw new DataSourceError(
      'fetch-failed',
      `台账取数失败：${describeError(error)}`,
      { cause: error },
    )
  }
}

/** 自相矛盾的取数条件当场说破，别拿它去问后端再收一份空结果。 */
function assertQuery(query: HistoryQuery): void {
  // ⚠ 就地校验身份而不是等后端 404：形状不对时后端只知道「没这张表」，
  // 说不出「这个串压根不是台账列的写法」
  if (parseDatasetBindingKey(query.nodeKey) === null) {
    throw new DataSourceError(
      'invalid-query',
      `不是台账列身份（应形如 ds:台账编码:列标识）：${query.nodeKey}`,
    )
  }
  assertRange(query)
}

function assertRange(query: HistoryQuery): void {
  const { fromMs, toMs, limit } = query.range
  // ⚠ 左右颠倒的时间窗后端只会回一段空序列，那与「这段时间没数据」长得一样
  if (fromMs !== undefined && toMs !== undefined && fromMs > toMs) {
    throw new DataSourceError(
      'invalid-query',
      `台账取数的时间窗左右颠倒：${fromMs} > ${toMs}`,
    )
  }
  if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) {
    throw new DataSourceError(
      'invalid-query',
      `台账取数的 limit 必须是正整数，收到 ${limit}`,
    )
  }
}
