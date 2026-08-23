/**
 * @fileoverview 点位历史这一面的两件纯活：把采集点位摊成勾选项，以及逐个点位
 * 取一段读数。与 Vue 无关，故单独一份。
 */
import type { CollectPoint, HistoryPoint } from '@dt/contracts'

import { fetchPointHistory } from '@/api/pointHistories'
import type { TrendItem } from '@/features/trend/trendSeries'

/**
 * 一个点位一次最多取多少个读数。
 * ⚠ 这个数要与截断提示里说的一致：`fetchPointHistory` 从窗口**起点**往后翻页，
 * 触顶时留下的是**最早**那一批，被砍掉的是更晚那一段。
 */
export const POINT_TREND_LIMIT = 2000

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
  }
}

/** 一个点位一段窗口的读数。 */
export interface OnePointReading {
  key: string
  points: HistoryPoint[]
  isTruncated: boolean
}

/**
 * 逐个点位取一段读数。
 * ⚠ 任何一个失败整次就失败：半张图比没有图更难判读，而缺的那半在图上看不出来。
 * @param wanted 已勾的点位
 * @param fromMs 窗口左端
 * @param toMs 窗口右端
 */
export async function readPointReadings(
  wanted: readonly TrendItem[],
  fromMs: number,
  toMs: number,
): Promise<OnePointReading[]> {
  return await Promise.all(
    wanted.map(async (item) => {
      const result = await fetchPointHistory({
        nodeKey: item.key,
        range: { fromMs, toMs, limit: POINT_TREND_LIMIT },
      })
      return {
        key: item.key,
        points: result.points,
        isTruncated: result.isTruncated,
      }
    }),
  )
}
