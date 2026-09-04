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
 * ⚠ 长窗配细档按桶网格切成几段并发问，段数有硬上限：超了就整窗降到自动档，
 * 并在结论上如实标出来——静默降档等于给累积量画一条压扁的假线。
 */
import type {
  ArchiveBindingDetail,
  CollectHistoryAggregate,
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

/**
 * 一条序列一次取数最多切多少段。
 * ⚠ 必须有上限：一年窗配 1 秒一格切得出十六万段，每段一次请求，这一屏就再也
 * 跑不完了（运行态每一跳作废重来、编辑器连作废都没有，会一直压着后端）。段数
 * 同时是并发请求数，故上限也是这一组的并发预算。
 */
const SEGMENTS_PER_READ_CAP = 8

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
      /**
       * 实际用的桶宽写法，只有降过档时才有：配的那一档切出的段数超了上限，
       * 整窗改用自动档。
       * ⚠ 降档一并算进 `isTruncated`：那是今天唯一一路带得到图例上的透传路，
       * 不这么写，用户看到的就是一条被压扁的曲线加零个提示。方向不写——两头
       * 都没被砍，缺的是分辨率。
       */
      coarsenedTo?: string
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
  // 而后端缺了它就跟业务时区的缺省走（`collect_bucket_timezone`，现网是东八区），
  // 所以这个字段今天在取数上没有任何作用。分组照样按它分开：接上之后不必改这里
  const key = JSON.stringify([
    detail.interval ?? '',
    detail.aggregate ?? '',
    detail.timezone ?? '',
    bounds.fromMs,
    bounds.toMs,
  ])
  const group = groups.get(key) ?? {
    ...bounds,
    bucket: bucketOf(bounds.toMs - bounds.fromMs, detail.interval),
    aggregate: detail.aggregate ?? DEFAULT_AGGREGATE,
    slots: new Map<string, string[]>(),
  }
  groups.set(key, group)
  const sharing = group.slots.get(detail.nodeKey)
  if (sharing === undefined) group.slots.set(detail.nodeKey, [fieldKey])
  else sharing.push(fieldKey)
}

/**
 * 这一组配的是哪一档桶宽。
 * ⚠ 用户明确选的那一档不因为窗口太长就降档，长窗先改成切段：一年 365 个日桶
 * 降成 2 天一格之后，日历上每一格就不是一天了。故这里先拿一段极短的窗口问档位表
 * 「认不认得这个写法」——认得就照它切段，认不得的才按整窗选自动档。切出的段数
 * 超上限那一步才降档，那一步在 `planRead`。
 * @param spanMs 整段窗口长度，只在回落自动档时用得上
 * @param interval 配的那一档，没配给 undefined
 */
function bucketOf(spanMs: number, interval: string | undefined): TrendBucket {
  const picked =
    interval === undefined
      ? null
      : resolveTrendBucket(LADDER_PROBE_MS, interval)
  if (picked !== null && picked.value === interval) return picked
  return resolveTrendBucket(Math.max(spanMs, 1), TREND_BUCKET_AUTO)
}

/**
 * 这一档在这段窗口下够不够得着：切出的段数超过上限就够不着，取数时会被降档。
 * ⚠ 界面上的禁用判据就是它，跟取数用的是同一个上限：两边各写一套的话，选得动
 * 的档取数时被降档，而屏上只剩一条粗了的曲线。
 * ⚠ 按最坏情况算——段起点要吸附到桶网格，最多把窗口撑长一格。
 * @param windowMs 窗口长度（毫秒）
 * @param interval 档位写法，`auto` 即跟着窗口走
 */
export function isBucketOutOfReach(
  windowMs: number,
  interval: string,
): boolean {
  const spanMs = Math.max(windowMs, 1)
  const bucket = bucketOf(
    spanMs,
    interval === TREND_BUCKET_AUTO ? undefined : interval,
  )
  const perCall = bucket.ms * BUCKETS_PER_CALL
  return Math.ceil((spanMs + bucket.ms) / perCall) > SEGMENTS_PER_READ_CAP
}

/**
 * 把窗口切成每段最多 `BUCKETS_PER_CALL` 个桶。
 * 自动档算出来的桶宽本来就装得下整窗，故只有用户自己选了细档的长窗切得出多段。
 * ⚠ 段起点先吸附到桶网格：库里的分桶是全局对齐的，而窗口左端是「此刻减去相对
 * 窗」这样一个任意毫秒。起点落在格子中间时，边界那一格被切成两半、两段各回半格，
 * 拼接时只留得下前一段那半格——sum / count 档就这么少一截，而曲线完全合法。
 * @param bounds 整段窗口
 * @param bucket 这一组用的桶宽
 */
function splitWindow(bounds: Segment, bucket: TrendBucket): Segment[] {
  const spanMs = bucket.ms * BUCKETS_PER_CALL
  const found: Segment[] = []
  for (
    let start = floorToBucket(bounds.fromMs, bucket.ms);
    start < bounds.toMs;
    start += spanMs
  ) {
    found.push({ fromMs: start, toMs: Math.min(start + spanMs, bounds.toMs) })
  }
  if (found.length === 0)
    found.push({ fromMs: bounds.fromMs, toMs: bounds.toMs })
  return found
}

/**
 * 一个时刻吸附到它所在那一格的起点。
 * ⚠ 带上时区偏移：日桶由库按当地零点对齐（后端 `collect_bucket_timezone` 现网
 * 是东八区），按 UNIX 纪元吸附的话日桶起点会整整差一个时区。取的是浏览器本地
 * 偏移——取数这条路今天下发不了时区（`ArchiveBindingDetail.timezone` 还没接），
 * 而现场的浏览器与后端在同一个时区。
 * @param atMs 要吸附的时刻
 * @param bucketMs 桶宽
 */
function floorToBucket(atMs: number, bucketMs: number): number {
  const offsetMs = -new Date(atMs).getTimezoneOffset() * 60_000
  return Math.floor((atMs + offsetMs) / bucketMs) * bucketMs - offsetMs
}

/** 这一组实际怎么取：桶宽、切好的段，以及有没有降过档。 */
interface ReadPlan {
  bucket: TrendBucket
  segments: readonly Segment[]
  /** 降过档时是降到了哪一档；没降就是 undefined。 */
  coarsenedTo?: string
}

/**
 * 这一组切成几段、用哪一档桶宽。
 * ⚠ 切超上限时整窗降到自动档，而不是把多出来的那些段丢掉：丢段是在曲线中间
 * 挖一个洞，而洞与「那几天真停机」在屏上长得一模一样。
 * @param group 这一组的窗口与桶宽
 */
function planRead(group: PointGroup): ReadPlan {
  const segments = splitWindow(group, group.bucket)
  if (segments.length <= SEGMENTS_PER_READ_CAP) {
    return { bucket: group.bucket, segments }
  }
  const coarse = bucketOf(group.toMs - group.fromMs, undefined)
  return {
    bucket: coarse,
    segments: splitWindow(group, coarse),
    coarsenedTo: coarse.value,
  }
}

/** 这一组要发的那几次请求：逐段、每段再按点位数切。 */
function callsOf(
  group: PointGroup,
  plan: ReadPlan,
): { segment: Segment; nodeKeys: readonly string[] }[] {
  const nodeKeys = [...group.slots.keys()]
  const found: { segment: Segment; nodeKeys: readonly string[] }[] = []
  for (const segment of plan.segments) {
    for (let at = 0; at < nodeKeys.length; at += NODE_KEYS_PER_CALL) {
      found.push({
        segment,
        nodeKeys: nodeKeys.slice(at, at + NODE_KEYS_PER_CALL),
      })
    }
  }
  return found
}

/** 取一组，成败都落在这一组自己头上。 */
async function readGroup(
  group: PointGroup,
  signal?: AbortSignal,
): Promise<Map<string, SeriesFetchOutcome>> {
  const plan = planRead(group)
  const readings = new Map<string, HistoryPoint[]>()
  let isTruncated = false
  let results: CollectHistoryAggregate[]
  try {
    // ⚠ 几段一起发而不是一段等一段：切出来的段之间互不相干，串行等于把一屏的
    // 首帧拖成段数乘以一次往返，而刷新节拍到点就把没跑完的那一轮整个作废
    results = await Promise.all(
      callsOf(group, plan).map(
        async (call) =>
          await fetchPointAggregate(
            {
              nodeKeys: call.nodeKeys,
              fromMs: call.segment.fromMs,
              toMs: call.segment.toMs,
              interval: plan.bucket.value,
              aggregate: group.aggregate,
            },
            signal,
          ),
      ),
    )
  } catch (caught) {
    return failGroup(group.slots, failureText(caught))
  }
  for (const result of results) {
    if (result.is_truncated) isTruncated = true
    absorbBuckets(readings, result.items)
  }
  return okGroup(group.slots, readings, isTruncated, plan.coarsenedTo)
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
  coarsenedTo: string | undefined,
): Map<string, SeriesFetchOutcome> {
  const found = new Map<string, SeriesFetchOutcome>()
  for (const [nodeKey, fieldKeys] of slots) {
    const points = pointsOf(readings, nodeKey)
    for (const fieldKey of fieldKeys) {
      found.set(fieldKey, {
        state: 'ok',
        points,
        isTruncated: isTruncated || coarsenedTo !== undefined,
        // ⚠ 聚合按桶起点升序取，触顶时留下的是最早那批、缺的是更晚那一段；
        //   降档没有砍掉任何一头，故这时不写方向
        ...(isTruncated ? { truncatedSide: 'late' as const } : {}),
        ...(coarsenedTo === undefined ? {} : { coarsenedTo }),
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
