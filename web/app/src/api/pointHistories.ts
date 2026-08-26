/**
 * @fileoverview 点位历史读侧的接口封装：把 `HistoryQuery` 翻成
 * `GET /point-histories` 的游标翻页，并给取数层一个能直接注入的 `fetchHistory`；
 * 另有一条走 `POST …:aggregate` 的分桶读法。
 *
 * ⚠ 取不到就 reject：绝不返回空 `points` 冒充「这段时间没数据」——那会画出一条
 * 「从打开页面才开始」的假曲线（DASHBOARD_DESIGN §4.3）。
 * ⚠ 两条读法各有各的用处，不是新旧关系：逐条是**原值**，绑定与导出要它；分桶是
 * **降采样**，一屏画几个小时的曲线要它。1 秒采样的点位一天有八万多条读数，逐条
 * 读只够读到窗口开头那一小截。
 */
import type {
  CollectHistoryAggregate,
  CursorPage,
  HistoryPoint,
  HistoryQuery,
  HistoryResult,
  HistoryTimeRange,
} from '@dt/contracts'

import { PLATFORM_BASE_URL } from '@/config/app'
import { requestData, type RequestOptions } from './client'

/** 服务端单页上限（openapi 钉死 200），翻页时按它取满。 */
const PAGE_LIMIT = 200

/** 不给数量上限时最多取多少个点；再多是渲染负担而非信息量。 */
const DEFAULT_MAX_POINTS = 1000

/** 相对窗与「只给 limit」时的兜底窗口。 */
const DEFAULT_WINDOW_MS = 60 * 60 * 1000

/** 一条历史读数的线形。 */
export interface HistoryPointWire {
  node_key: string
  ts: string
  value: unknown
  quality: 'good' | 'uncertain' | 'bad'
}

function onPlatform(options: RequestOptions = {}): RequestOptions {
  return { ...options, baseUrl: PLATFORM_BASE_URL }
}

/** 解析 `1h` / `7d` 这类相对窗；不认识的写法回落一小时。 */
export function windowToMs(lastWindow: string | undefined): number {
  const matched = /^(\d{1,4})(s|m|h|d)$/.exec(lastWindow ?? '')
  if (matched === null) return DEFAULT_WINDOW_MS
  const amount = Number(matched[1])
  const unit = matched[2]
  const scale =
    unit === 's'
      ? 1000
      : unit === 'm'
        ? 60_000
        : unit === 'h'
          ? 3_600_000
          : 86_400_000
  return amount * scale
}

/**
 * 把范围口径落成一段具体的时间窗。
 * `fromMs` 优先于 `lastWindow`；只给 `limit` 时按兜底窗口取最新一段。
 * @param range 绑定里的范围口径
 * @param nowMs 当前时刻，测试注入
 */
export function resolveWindow(
  range: HistoryTimeRange,
  nowMs: number,
): { fromMs: number; toMs: number } {
  const toMs = range.toMs ?? nowMs
  const fromMs = range.fromMs ?? toMs - windowToMs(range.lastWindow)
  return { fromMs: Math.min(fromMs, toMs), toMs }
}

/**
 * 读一个点位一段窗口的历史，翻页取齐后按时刻升序返回。
 * 点数触顶时如实标 `isTruncated`，不砍窗口冒充取齐了。
 */
export async function fetchPointHistory(
  query: HistoryQuery,
  nowMs = Date.now(),
): Promise<HistoryResult> {
  const { fromMs, toMs } = resolveWindow(query.range, nowMs)
  const maxPoints = query.range.limit ?? DEFAULT_MAX_POINTS
  const points: HistoryPoint[] = []
  let after: string | undefined
  let hasMore = true

  while (hasMore && points.length < maxPoints) {
    const page = await requestData<CursorPage<HistoryPointWire>>(
      '/point-histories',
      onPlatform({
        query: {
          node_keys: query.nodeKey,
          range_start: new Date(fromMs).toISOString(),
          range_end: new Date(toMs).toISOString(),
          limit: Math.min(PAGE_LIMIT, maxPoints - points.length),
          after,
        },
      }),
    )
    for (const item of page.items) {
      points.push({ t: Date.parse(item.ts), v: item.value })
    }
    hasMore = page.has_more
    after = page.next ?? undefined
    if (after === undefined) break
  }

  return {
    points,
    isTruncated: hasMore && points.length >= maxPoints,
    isStale: false,
  }
}

/** 一次分桶聚合要问的东西。 */
export interface PointAggregateQuery {
  /** 一次最多 50 个，与后端 `MAX_NODE_KEYS` 同值。 */
  nodeKeys: readonly string[]
  fromMs: number
  toMs: number
  /** `15m` 这样的桶宽，形状由后端正则钉死。 */
  interval: string
  aggregate: string
}

/**
 * 一次问一批点位的分桶聚合。
 * ⚠ 一次请求问全部点位，而不是一个点位一次：谓词是 `(source_id, point_code) IN
 * (…)`，一次扫过去比 N 次各扫一遍便宜得多，也免掉 N 条链路各自失败的分叉。
 * @param query 点位、窗口、桶宽与档位
 * @param signal 取消信号
 */
export async function fetchPointAggregate(
  query: PointAggregateQuery,
  signal?: AbortSignal,
): Promise<CollectHistoryAggregate> {
  return await requestData<CollectHistoryAggregate>(
    '/point-histories:aggregate',
    onPlatform({
      method: 'POST',
      body: {
        node_keys: [...query.nodeKeys],
        range_start: new Date(query.fromMs).toISOString(),
        range_end: new Date(query.toMs).toISOString(),
        interval: query.interval,
        aggregate: query.aggregate,
      },
      ...(signal === undefined ? {} : { signal }),
    }),
  )
}
