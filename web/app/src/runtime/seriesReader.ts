/**
 * @fileoverview 大屏时序槽的取数分派：按取数说明自己的字段认出这一条要问点位
 * 归档还是台账列，交给各自那条批量适配器，再把两边的结论并成一张表；另有台账
 * provider 那条按单条问的口。
 *
 * ⚠ 认来源的这条缝就在这一层：`@dt/runtime` 只按清单上的时序声明挑槽，一个来源
 * 种类都不认识（docs/DASHBOARD_CHART_MODULES_DESIGN.md §5.4）。
 * ⚠ 判别按字段存在性而不是来源串：`sourceKind` 到不了这一层，而两支取数说明的
 * 字段互不相同——点位那支有 `nodeKey`，台账那支有 `datasetKey`。摸错字段拿到的是
 * `undefined`，它会一路流成一次「没配点位」，而不是一条说得出原因的报错。
 */
import type {
  ArchiveBindingDetail,
  BindingDetail,
  DatasetBindingDetail,
  HistoryQuery,
  HistoryResult,
  SeriesOutcome,
  SeriesRequest,
} from '@dt/contracts'
import { DataSourceError } from '@dt/datasources'

import {
  readDatasetSeries,
  type DatasetSeriesRequest,
} from '@/api/datasetSeries'
import { readPointSeries, type PointSeriesRequest } from '@/api/pointSeries'

/** 两支都认不出来时说的那句。 */
const UNKNOWN_DETAIL = '认不出这条取数说明要问点位归档还是台账列'

/** 一批一条时占位的槽键：单条口自己一问一答，不经过回填。 */
const ONE_SLOT = 'one'

/** 这一支这一轮没有要取的，省掉一次空请求。 */
const NONE: ReadonlyMap<string, SeriesOutcome> = new Map()

/**
 * 这条取数说明是不是点位归档那一支。
 * @param detail 取数说明原文
 */
function archiveOf(detail: BindingDetail): ArchiveBindingDetail | null {
  return 'nodeKey' in detail && typeof detail.nodeKey === 'string'
    ? detail
    : null
}

/**
 * 这条取数说明是不是台账列那一支。
 * @param detail 取数说明原文
 */
function datasetOf(detail: BindingDetail): DatasetBindingDetail | null {
  return 'datasetKey' in detail && typeof detail.datasetKey === 'string'
    ? detail
    : null
}

/**
 * 取一批时序槽的历史序列，按槽键回填结论。
 * ⚠ 两支各发各的再并起来：一支整个失败也拖不掉另一支，而适配器内部已经把失败
 * 落成逐槽的 `error`。
 * @param requests 这一轮要取的全部序列
 * @param signal 作废在飞的这一次
 */
export async function readDashboardSeries(
  requests: readonly SeriesRequest[],
  signal: AbortSignal,
): Promise<ReadonlyMap<string, SeriesOutcome>> {
  const points: PointSeriesRequest[] = []
  const columns: DatasetSeriesRequest[] = []
  const found = new Map<string, SeriesOutcome>()
  for (const request of requests) {
    const archive = archiveOf(request.detail)
    if (archive !== null) {
      points.push({ fieldKey: request.fieldKey, detail: archive })
      continue
    }
    const column = datasetOf(request.detail)
    if (column === null) {
      found.set(request.fieldKey, { state: 'error', message: UNKNOWN_DETAIL })
      continue
    }
    columns.push({ fieldKey: request.fieldKey, detail: column })
  }
  const both = await Promise.all([
    points.length === 0 ? NONE : readPointSeries(points, signal),
    columns.length === 0 ? NONE : readDatasetSeries(columns, signal),
  ])
  for (const outcomes of both) {
    for (const [fieldKey, outcome] of outcomes) found.set(fieldKey, outcome)
  }
  return found
}

/**
 * 台账 provider 那条按单条问的口：折成一批一条，走的是同一条批量路径。
 * ⚠ 取不到必须抛：provider 的口径是失败一律 reject，返回一条空 `points` 会被
 * 读成「这段时间确实没数据」（`packages/datasources/src/dataset/provider.ts`）。
 * @param query 台账列身份与时间范围
 */
export async function fetchDatasetSeries(
  query: HistoryQuery,
): Promise<HistoryResult> {
  const found = await readDatasetSeries([
    {
      fieldKey: ONE_SLOT,
      detail: { datasetKey: query.nodeKey, range: query.range },
    },
  ])
  const outcome = found.get(ONE_SLOT)
  if (outcome === undefined || outcome.state === 'error') {
    // ⚠ 一律落 `fetch-failed`：批量口把拆不动的说明也折成了 error 文案，
    // 到这里已经分不出「问不到」与「压根不是台账列身份」，而后者在 provider
    // 自己的 `assertQuery` 那一关就先被挡下了
    throw new DataSourceError(
      'fetch-failed',
      outcome?.message ?? '台账取数没有回这一条',
    )
  }
  return {
    points: [...outcome.points],
    isTruncated: outcome.isTruncated,
    isStale: outcome.isStale,
  }
}
