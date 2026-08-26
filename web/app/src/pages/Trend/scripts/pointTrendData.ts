/**
 * @fileoverview 点位历史这一面的三件纯活：把采集点位摊成勾选项、筛出「画得
 * 出曲线」的那些、以及一次问一批点位的分桶读数。与 Vue 无关，故单独一份。
 */
import type { CollectPoint, HistoryPoint } from '@dt/contracts'

import { fetchPointAggregate } from '@/api/pointHistories'
import {
  chooseTrendBucket,
  withBucketGaps,
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

/**
 * 取一批点位在一段窗口上的分桶读数。
 * ⚠ 一次请求问全部点位：逐个点位各发一次的话，8 个点位就是 8 条各自会失败的
 * 链路，而半张图在界面上与「那几个点位没数据」长得一模一样。
 * ⚠ 桶宽按窗口自己选，不让用户填：填得太细就是一条被截断的半截曲线，而截断
 * 这件事只能事后解释。
 * @param wanted 已勾的点位
 * @param fromMs 窗口左端
 * @param toMs 窗口右端
 * @param aggregate 折算档位
 * @param signal 取消信号
 */
export async function readPointReadings(
  wanted: readonly TrendItem[],
  fromMs: number,
  toMs: number,
  aggregate: string,
  signal?: AbortSignal,
): Promise<PointReadings> {
  const bucket = chooseTrendBucket(toMs - fromMs)
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
    readings: [...grouped].map(([key, points]) => ({
      key,
      points: withBucketGaps(points, bucket.ms),
    })),
    bucket,
    isTruncated: result.is_truncated,
  }
}
