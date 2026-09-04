/**
 * @fileoverview 点位历史序列的批量取数：把若干条 `archive` 取数说明折成尽可能
 * 少的 `POST /point-histories:aggregate`，再按槽键把结论发回去。
 *
 * ⚠ 走分桶而不是逐条原值：1 秒采样的点位配 1 小时窗有 3600 条读数，逐条读只
 * 画得到开头那十几分钟，而 x 轴照样横跨整个窗口——看的人读成「后面设备停了」
 * （docs/DASHBOARD_CHART_MODULES_DESIGN.md §5.1）。
 * ⚠ 同窗同档的点位并成一次请求：一屏三块图各 6 条系列逐条取数是每分钟 90 次
 * 串行往返，而一次聚合收得下 50 个点位。
 * ⚠ 取不到与「取到了但窗内 0 点」是两码事：前者落 `error`，后者是 `ok` 加一条
 * 空 `points`。拿空序列冒充取不到，画出来是一张看不出问题的空图。
 */
import type {
  ArchiveBindingDetail,
  CollectHistoryBucket,
  HistoryPoint,
} from '@dt/contracts'

import {
  resolveTrendBucket,
  TREND_BUCKET_AUTO,
  type TrendBucket,
} from '@/features/trend/trendBucket'

import { fetchPointAggregate, resolveWindow } from './pointHistories'

/** 一次聚合最多问多少个点位，与后端 `MAX_NODE_KEYS` 同值。 */
const NODE_KEYS_PER_CALL = 50

/**
 * 一次聚合每个点位最多问多少个桶。
 * ⚠ 刻意低于后端每点位 `MAX_PAGE_SIZE`（200）：桶起点按业务时区对齐，窗口两端
 * 各会多出半格，正好卡在上限上会溢出一两行、换回一条被截了尾的曲线。切了段之后
 * 再触顶，缺的那一截是在中间而不是末尾，那就更看不出来了。
 */
const BUCKETS_PER_CALL = 190

/** 探档位表用的窗口长度：短到任何一档都不算太细。 */
const LADDER_PROBE_MS = 1

/** 没配聚合档位时跟后端 `AggregateIn.aggregate` 的缺省走。 */
const DEFAULT_AGGREGATE = 'avg'

/** 触顶砍掉的是哪一头。 */
export type TruncatedSide = 'early' | 'late'

/**
 * 一条序列取数的结论。
 * ⚠ `state: 'ok'` 且 `points: []` 是「取到了，窗内确实没数据」；取不到一律
 * `error`，两者在图上必须长得不一样。
 */
export type SeriesFetchOutcome =
  | {
      state: 'ok'
      /** 按时刻升序。 */
      points: readonly HistoryPoint[]
      /** 窗内还有更多点，只取回了上限那批。 */
      isTruncated: boolean
      /** 触顶砍掉的是哪一头；文案据此写，不许写一句通用的「数据被截断」。 */
      truncatedSide?: TruncatedSide
      /** 值来自降级路径。陈旧必须标注为陈旧。 */
      isStale: boolean
    }
  | { state: 'error'; message: string }

/** 一条待取的点位序列绑定。 */
export interface PointSeriesRequest {
  /** 槽键，回填时按它对号入座。 */
  fieldKey: string
  detail: ArchiveBindingDetail
}

/** 一组并成同一次请求的绑定：窗口、桶宽与聚合档位都相同。 */
interface PointGroup {
  fromMs: number
  toMs: number
  bucket: TrendBucket
  aggregate: string
  /** 点位身份 → 要它的那些槽键。 */
  slots: Map<string, string[]>
}

/** 一段要单独问一次的窗口。 */
interface Segment {
  fromMs: number
  toMs: number
}

/**
 * 取一批点位序列，按槽键回填结论。
 * ⚠ 一条失败不拖垮整批：分组各自成败，取不到的那几个槽落 `error`，其余照常出数。
 * @param requests 要取的那些绑定
 * @param signal 取消信号
 * @param nowMs 当前时刻，测试注入
 */
export async function readPointSeries(
  requests: readonly PointSeriesRequest[],
  signal?: AbortSignal,
  nowMs: number = Date.now(),
): Promise<ReadonlyMap<string, SeriesFetchOutcome>> {
  const found = new Map<string, SeriesFetchOutcome>()
  const groups = new Map<string, PointGroup>()
  for (const request of requests) {
    try {
      absorbRequest(groups, request, nowMs)
    } catch (caught) {
      found.set(request.fieldKey, {
        state: 'error',
        message: failureText(caught),
      })
    }
  }
  await Promise.all(
    [...groups.values()].map(async (group) => {
      for (const [fieldKey, outcome] of await readGroup(group, signal)) {
        found.set(fieldKey, outcome)
      }
    }),
  )
  return found
}

/** 把一条绑定并进它该在的那一组。 */
function absorbRequest(
  groups: Map<string, PointGroup>,
  request: PointSeriesRequest,
  nowMs: number,
): void {
  const { detail, fieldKey } = request
  const bounds = resolveWindow(detail.range, nowMs)
  // ⚠ 时区进得了分组键、发不出去：`fetchPointAggregate` 今天不带 timezone 参数，
  // 而后端不带时区时按 UNIX 纪元对齐日桶——东八区的日桶会从当地 08:00 开始。
  // 已知欠账，日历热力那一档要用到它；分组先按它分开，接上之后不必再改这里
  const key = JSON.stringify([
    detail.interval ?? '',
    detail.aggregate ?? '',
    detail.timezone ?? '',
    bounds.fromMs,
    bounds.toMs,
  ])
  const group = groups.get(key) ?? {
    ...bounds,
    bucket: bucketOf(bounds, detail.interval),
    aggregate: detail.aggregate ?? DEFAULT_AGGREGATE,
    slots: new Map<string, string[]>(),
  }
  groups.set(key, group)
  const sharing = group.slots.get(detail.nodeKey)
  if (sharing === undefined) group.slots.set(detail.nodeKey, [fieldKey])
  else sharing.push(fieldKey)
}

/**
 * 这一组用哪一档桶宽。
 * ⚠ 用户明确选的那一档不许因为窗口太长被降档，长窗改成切段：一年 365 个日桶
 * 降成 2 天一格之后，日历上每一格就不是一天了。故这里先拿一段极短的窗口问档位表
 * 「认不认得这个写法」——认得就照它切段，认不得的才按整窗选自动档。
 */
function bucketOf(bounds: Segment, interval: string | undefined): TrendBucket {
  const picked =
    interval === undefined
      ? null
      : resolveTrendBucket(LADDER_PROBE_MS, interval)
  if (picked !== null && picked.value === interval) return picked
  return resolveTrendBucket(
    Math.max(bounds.toMs - bounds.fromMs, 1),
    TREND_BUCKET_AUTO,
  )
}

/**
 * 把窗口切成每段最多 `BUCKETS_PER_CALL` 个桶。
 * 自动档算出来的桶宽本来就装得下整窗，故只有用户自己选了细档的长窗切得出多段。
 */
function splitWindow(group: PointGroup): Segment[] {
  const spanMs = group.bucket.ms * BUCKETS_PER_CALL
  const found: Segment[] = []
  for (let start = group.fromMs; start < group.toMs; start += spanMs) {
    found.push({ fromMs: start, toMs: Math.min(start + spanMs, group.toMs) })
  }
  if (found.length === 0) found.push({ fromMs: group.fromMs, toMs: group.toMs })
  return found
}

/** 取一组，成败都落在这一组自己头上。 */
async function readGroup(
  group: PointGroup,
  signal?: AbortSignal,
): Promise<Map<string, SeriesFetchOutcome>> {
  const nodeKeys = [...group.slots.keys()]
  const readings = new Map<string, HistoryPoint[]>()
  let isTruncated = false
  try {
    for (const segment of splitWindow(group)) {
      for (let at = 0; at < nodeKeys.length; at += NODE_KEYS_PER_CALL) {
        const result = await fetchPointAggregate(
          {
            nodeKeys: nodeKeys.slice(at, at + NODE_KEYS_PER_CALL),
            fromMs: segment.fromMs,
            toMs: segment.toMs,
            interval: group.bucket.value,
            aggregate: group.aggregate,
          },
          signal,
        )
        if (result.is_truncated) isTruncated = true
        absorbBuckets(readings, result.items)
      }
    }
  } catch (caught) {
    return failGroup(group.slots, failureText(caught))
  }
  return okGroup(group.slots, readings, isTruncated)
}

/** 把一批桶按点位摊进读数表。 */
function absorbBuckets(
  readings: Map<string, HistoryPoint[]>,
  items: readonly CollectHistoryBucket[],
): void {
  for (const item of items) {
    append(pointsOf(readings, item.node_key), {
      t: Date.parse(item.bucket_start),
      v: item.value,
    })
  }
}

/**
 * 追加一个点。
 * ⚠ 段与段的边界那一格两边都会回，重复的丢掉后来那一次；桶起点是升序的，
 * 故「不比上一个晚」就是重复。
 */
function append(into: HistoryPoint[], point: HistoryPoint): void {
  const last = into.at(-1)
  if (last !== undefined && point.t <= last.t) return
  into.push(point)
}

/** 取这个点位的读数数组，没有就现开一个。 */
function pointsOf(
  readings: Map<string, HistoryPoint[]>,
  nodeKey: string,
): HistoryPoint[] {
  const found = readings.get(nodeKey)
  if (found !== undefined) return found
  const fresh: HistoryPoint[] = []
  readings.set(nodeKey, fresh)
  return fresh
}

/** 整组取到了：逐槽发回各自那条序列。 */
function okGroup(
  slots: ReadonlyMap<string, string[]>,
  readings: Map<string, HistoryPoint[]>,
  isTruncated: boolean,
): Map<string, SeriesFetchOutcome> {
  const found = new Map<string, SeriesFetchOutcome>()
  for (const [nodeKey, fieldKeys] of slots) {
    const points = pointsOf(readings, nodeKey)
    for (const fieldKey of fieldKeys) {
      found.set(fieldKey, {
        state: 'ok',
        points,
        isTruncated,
        // ⚠ 聚合按桶起点升序取，触顶时留下的是最早那批、缺的是更晚那一段
        ...(isTruncated ? { truncatedSide: 'late' as const } : {}),
        isStale: false,
      })
    }
  }
  return found
}

/** 整组没取到：这一组的每个槽都说同一句为什么。 */
function failGroup(
  slots: ReadonlyMap<string, string[]>,
  message: string,
): Map<string, SeriesFetchOutcome> {
  const found = new Map<string, SeriesFetchOutcome>()
  for (const fieldKeys of slots.values()) {
    for (const fieldKey of fieldKeys)
      found.set(fieldKey, { state: 'error', message })
  }
  return found
}

/** 取不到时说给人看的那句。 */
function failureText(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught)
}
