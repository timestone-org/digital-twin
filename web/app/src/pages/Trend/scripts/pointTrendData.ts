/**
 * @fileoverview 点位历史这一面的两件纯活：把采集点位摊成勾选项，以及一次问
 * 一批点位的分桶读数。与 Vue 无关，故单独一份。
 */
import type { CollectPoint, HistoryPoint } from '@dt/contracts'

import { fetchPointAggregate } from '@/api/pointHistories'
import {
  holdBucketValues,
  resolveTrendBucket,
  type TrendBucket,
} from '@/features/trend/trendBucket'
import type { TrendItem } from '@/features/trend/trendSeries'

/**
 * 把一个采集点位摊成勾选项。
 * ⚠ 没开归档的点位要在名字上标出来：它勾得上、也查得动，只是**永远**取不到
 * 一条读数。不标的话那条空曲线会被读成「这段时间设备停了」。
 * @param point 采集点位
 */
export function toTrendItem(point: CollectPoint): TrendItem {
  const unit = point.unit === null ? '' : `（${point.unit}）`
  const mark = point.archive_enabled ? '' : ' · 未记录历史'
  return {
    key: point.node_key,
    label: `${point.name}${unit}${mark}`,
    unit: point.unit ?? '',
    isDrawable: point.archive_enabled,
    holdMs: point.archive_max_interval_ms,
  }
}

/** 一个点位一段窗口的读数。 */
export interface OnePointReading {
  key: string
  points: HistoryPoint[]
}

/** 一次取数的全部结果：每个点位一条序列，加上这次真正用的桶宽。 */
export interface PointReadings {
  readings: OnePointReading[]
  bucket: TrendBucket
  /** 桶数触顶，更晚的那一段没取回来。 */
  isTruncated: boolean
}

/** 取一次分桶读数要的那几样。 */
export interface PointQuery {
  wanted: readonly TrendItem[]
  fromMs: number
  toMs: number
  aggregate: string
  /** 界面上选的取点间隔，`auto` 即跟着窗口走。 */
  interval: string
}

/**
 * 取一批点位在一段窗口上的分桶读数。
 * ⚠ 一次请求问全部点位：逐个点位各发一次的话，8 个点位就是 8 条各自会失败的
 * 链路，而半张图在界面上与「那几个点位没数据」长得一模一样。
 * ⚠ 空掉的格按各自的归档心跳结转上一个读数，不是画成断档——理由见
 * `holdBucketValues`。心跳是**逐点位**的，故补格也逐点位算。
 * @param query 点位、窗口、折算档位与取点间隔
 * @param signal 取消信号
 */
export async function readPointReadings(
  query: PointQuery,
  signal?: AbortSignal,
): Promise<PointReadings> {
  const { wanted, fromMs, toMs, aggregate, interval } = query
  const bucket = resolveTrendBucket(toMs - fromMs, interval)
  const result = await fetchPointAggregate(
    {
      nodeKeys: wanted.map((item) => item.key),
      fromMs,
      toMs,
      interval: bucket.value,
      aggregate,
    },
    signal,
  )
  const grouped = new Map<string, HistoryPoint[]>(
    wanted.map((item) => [item.key, []]),
  )
  for (const one of result.items) {
    grouped.get(one.node_key)?.push({
      t: Date.parse(one.bucket_start),
      v: one.value,
    })
  }
  return {
    readings: wanted.map((item) => ({
      key: item.key,
      points: holdBucketValues(grouped.get(item.key) ?? [], {
        bucketMs: bucket.ms,
        holdMs: item.holdMs,
        toMs,
      }),
    })),
    bucket,
    isTruncated: result.is_truncated,
  }
}
