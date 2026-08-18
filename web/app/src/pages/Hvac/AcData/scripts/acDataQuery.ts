/**
 * @fileoverview 空调原始数据页的取值规则：默认区间、区间校验、默认画哪几条、
 * 以及把聚合序列摊成 DtLineChart 要的形状。都是纯函数，与 Vue 无关。
 */
import type { AcMetric, RawSeries } from '@dt/contracts'
import type { DtChartPoint, DtChartSeries } from '@dt/ui'

/** 折线图一次最多画几条：再多就分不清颜色，也读不出交叉。 */
export const MAX_CHARTED_METRICS = 8

const HOUR_MS = 3_600_000
/** 默认回看多久。取 6 小时：够看出一班的走势，又不至于一进页面就拉一整天。 */
const DEFAULT_SPAN_HOURS = 6

export interface RawRangeValue {
  from: string
  to: string
}

export interface RangePreset {
  hours: number
  label: string
}

export const RANGE_PRESETS: readonly RangePreset[] = [
  { hours: 1, label: '近 1 小时' },
  { hours: 6, label: '近 6 小时' },
  { hours: 24, label: '近 24 小时' },
]

/**
 * 截止到 `now`、往前若干小时的区间。
 * @param hours 回看多少小时
 * @param now 当前时刻，由调用方注入以便测试
 */
export function rangeOfLastHours(hours: number, now: Date): RawRangeValue {
  const end = now.getTime()
  return {
    from: new Date(end - hours * HOUR_MS).toISOString(),
    to: new Date(end).toISOString(),
  }
}

/**
 * 截止到此刻、往前若干小时。
 * ⚠ 时钟只在这里读：组件里出现 `new Date()` 会被风格闸拦下，也让用例没法固定时间。
 * @param hours 回看多少小时
 */
export function recentRange(hours: number): RawRangeValue {
  return rangeOfLastHours(hours, new Date())
}

/**
 * 默认区间：够看出一班的走势，又不至于一进页面就拉一整天。
 * @param now 当前时刻
 */
export function defaultRange(now: Date): RawRangeValue {
  return rangeOfLastHours(DEFAULT_SPAN_HOURS, now)
}

/**
 * 区间是否可以拿去取数；不行时给一句能显示的原因。
 * ⚠ 只挡「填不全」与「倒置」这两条本地就看得出的：跨度上限由后端按数据集定，
 * 在前端再抄一份必然与后端漂开，超限一律等后端的 41613。
 * @param range 当前区间
 */
export function rangeProblem(range: RawRangeValue): string | null {
  if (range.from === '' || range.to === '') return '请把开始与结束时间都选上'
  if (range.from >= range.to) return '开始时间必须早于结束时间'
  return null
}

/**
 * 默认勾选的指标：目录里标了 `is_charted_by_default` 的那些，至多 8 条。
 * @param metrics 当前数据集的全部指标
 */
export function defaultMetrics(metrics: readonly AcMetric[]): string[] {
  return metrics
    .filter((item) => item.is_charted_by_default)
    .slice(0, MAX_CHARTED_METRICS)
    .map((item) => item.key)
}

/**
 * 把聚合序列摊成折线图的系列。
 * ⚠ 桶里没有取值时给 `null` 而不是跳过这个点：跳过会让断档被连成一条直线，
 * 而 null 才画成缺口。
 * @param series 后端给的聚合结果
 * @param metrics 当前数据集的指标目录，用来取名字、量纲与 Y 轴分组
 */
export function toChartSeries(
  series: RawSeries,
  metrics: readonly AcMetric[],
): DtChartSeries[] {
  const catalog = new Map(metrics.map((item) => [item.key, item]))
  return series.metrics.map((key) => {
    const found = catalog.get(key)
    const points: DtChartPoint[] = series.points.map((point) => [
      point.ts,
      point.values[key] ?? null,
    ])
    return {
      key,
      name: found?.name ?? key,
      unit: found?.unit ?? '',
      // 分组直接当轴用：同组共用一条 Y 轴，温度与湿度因此各占一边
      axis: found?.group ?? 'default',
      points,
    }
  })
}

/**
 * 勾选指标时的下一份取值；到上限就不再加。
 * @param selected 当前已选
 * @param metric 被点的指标
 */
export function toggleMetric(
  selected: readonly string[],
  metric: string,
): string[] {
  if (selected.includes(metric)) {
    return selected.filter((item) => item !== metric)
  }
  if (selected.length >= MAX_CHARTED_METRICS) return [...selected]
  return [...selected, metric]
}
