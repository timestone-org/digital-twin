/**
 * @fileoverview 历史档的类目轴：把几行各自取回的序列并成一条共享的时刻轴，
 * 再把时刻按这一屏的疏密换成刻度文案。纯函数，不碰 DOM 也不碰 echarts。
 *
 * ⚠ 时刻轴取的是**并集**而不是第一行的那一条：取数窗口住在每条绑定上
 * （`BindingSourceEditor` 写进 `detailJson`），同一块图里两行的窗口与桶宽可以不同。
 * 拿第一行的时刻当轴，第二行的点会被整片对不上位、静默画不出来。
 * ⚠ 缺格补 `null` 而不是 0：柱图上 0 是一个真读数，「这一桶没采到」画成 0 会
 * 把停机读成产量归零。
 * ⚠ 刻度按**相邻类目的间隔**选档而不是按总跨度：一小时窗里 10 秒一桶时按跨度选出
 * 的「时:分」会让六个相邻刻度显示成同一个字样。
 */
import type { HistoryPoint } from '@dt/contracts'

/** 一分钟与一天的毫秒数，选刻度档用。 */
const MINUTE_MS = 60_000
const DAY_MS = 86_400_000

/** 跨过这么多天就不再写时分，只写日期。 */
const MONTH_MS = 28 * DAY_MS

/** 共享时刻轴与逐行对齐后的取值。 */
export interface BucketGrid {
  /** 时刻，UTC 毫秒，升序去重。 */
  stamps: number[]
  /** 时刻的刻度文案，与 `stamps` 一一对应。 */
  labels: string[]
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

/**
 * 相邻时刻的最小间隔；不足两个时刻时给 0。
 * ⚠ 取最小而不是取中位：混着两种桶宽时，按粗的那一档写刻度会让细的那几格重名。
 * @param stamps 升序时刻
 */
export function stepOf(stamps: readonly number[]): number {
  let step = Number.POSITIVE_INFINITY
  for (let at = 1; at < stamps.length; at += 1) {
    const gap = (stamps[at] ?? 0) - (stamps[at - 1] ?? 0)
    if (gap > 0 && gap < step) step = gap
  }
  return Number.isFinite(step) ? step : 0
}

/**
 * 一个时刻的刻度文案。本地时区，与 `format.ts` 的 `fmtClock` 同口径。
 * ⚠ 桶边界是后端按 `timezone` 切好的，这里只负责写字；两边用不同的时区会让
 * 「跨零点的那一桶」写在错误的一天上。
 * @param stampMs 时刻，UTC 毫秒
 * @param step 相邻类目的间隔，毫秒；0 表示只有一个类目
 * @param spanMs 整条轴的跨度，毫秒
 */
export function labelOf(stampMs: number, step: number, spanMs: number): string {
  const at = new Date(stampMs)
  if (Number.isNaN(at.getTime())) return ''
  const date = `${pad2(at.getMonth() + 1)}-${pad2(at.getDate())}`
  const clock = `${pad2(at.getHours())}:${pad2(at.getMinutes())}`
  if (step >= MONTH_MS) return `${String(at.getFullYear())}-${date}`
  if (step >= DAY_MS) return date
  if (step > 0 && step < MINUTE_MS) {
    return `${clock}:${pad2(at.getSeconds())}`
  }
  // 跨了不止一天却还按时分写刻度，「昨天 08:00」与「今天 08:00」会长得一模一样
  return spanMs > DAY_MS ? `${date} ${clock}` : clock
}

/**
 * 几行序列的共享时刻轴。
 * @param rows 逐行取回的序列；缺席的行传 undefined
 */
export function buildGrid(
  rows: readonly (readonly HistoryPoint[] | undefined)[],
): BucketGrid {
  const seen = new Set<number>()
  for (const points of rows) {
    for (const point of points ?? []) {
      if (Number.isFinite(point.t)) seen.add(point.t)
    }
  }
  const stamps = [...seen].sort((left, right) => left - right)
  const step = stepOf(stamps)
  const span = (stamps[stamps.length - 1] ?? 0) - (stamps[0] ?? 0)
  return { stamps, labels: stamps.map((at) => labelOf(at, step, span)) }
}

/**
 * 一行序列按共享时刻轴对齐。
 * ⚠ 同一时刻重复出现时留**后**一个：分桶聚合偶尔会在窗口边界上给出两条同刻的行，
 * 后一条是补齐的那一条。
 * @param stamps 共享时刻轴
 * @param points 这一行取回的序列；缺席给一整行 null
 */
export function alignTo(
  stamps: readonly number[],
  points: readonly HistoryPoint[] | undefined,
): (number | null)[] {
  const byStamp = new Map<number, number | null>()
  for (const point of points ?? []) {
    const value = point.v
    byStamp.set(
      point.t,
      typeof value === 'number' && Number.isFinite(value) ? value : null,
    )
  }
  return stamps.map((at) => byStamp.get(at) ?? null)
}
