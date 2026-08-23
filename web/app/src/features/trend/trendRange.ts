/**
 * @fileoverview 趋势图的时间范围：几档相对窗 + 自定义起止。
 *
 * ⚠ 时钟只在这一层读：组件里出现 `new Date(` 会被风格闸拦下，也让用例没法把
 * 时间钉死。两个数据源共用同一份档位——同一段「最近 24 小时」在两张图上必须
 * 指同一段时间，各写一份迟早会差出一个档。
 */

const HOUR_MS = 3_600_000

/** 一档相对窗。`hours` 为 0 即「自定义」。 */
export interface TrendRangePreset {
  value: string
  label: string
  hours: number
}

/** 自定义档的取值。 */
export const TREND_RANGE_CUSTOM = 'custom'

export const TREND_RANGE_PRESETS: readonly TrendRangePreset[] = [
  { value: '1h', label: '最近 1 小时', hours: 1 },
  { value: '6h', label: '最近 6 小时', hours: 6 },
  { value: '24h', label: '最近 24 小时', hours: 24 },
  { value: '7d', label: '最近 7 天', hours: 24 * 7 },
  { value: '30d', label: '最近 30 天', hours: 24 * 30 },
  { value: TREND_RANGE_CUSTOM, label: '自定义', hours: 0 },
]

/** 进页面默认看哪一档。一天够看出一班的走势，又不至于一进来就拉一个月。 */
export const TREND_RANGE_DEFAULT = '24h'

/** 一段落到具体毫秒的窗口。 */
export interface TrendWindow {
  fromMs: number
  toMs: number
}

/** 界面上的范围取值：档位 + 自定义的两端（UTC RFC3339，空串表示没选）。 */
export interface TrendRangeValue {
  preset: string
  from: string
  to: string
}

/** 初始范围：默认档，自定义两端留空。 */
export function defaultTrendRange(): TrendRangeValue {
  return { preset: TREND_RANGE_DEFAULT, from: '', to: '' }
}

/**
 * 把界面取值落成一段窗口；落不成时给一句能显示的原因。
 * ⚠ 只挡「填不全」与「倒置」这两条本地就看得出的：跨度上限由后端定，在前端
 * 再抄一份必然与后端漂开。
 * @param range 界面上的范围取值
 * @param nowMs 当前时刻，测试注入
 */
export function resolveTrendRange(
  range: TrendRangeValue,
  nowMs: number = Date.now(),
): { window: TrendWindow | null; problem: string | null } {
  if (range.preset !== TREND_RANGE_CUSTOM) {
    const preset = TREND_RANGE_PRESETS.find(
      (item) => item.value === range.preset,
    )
    const hours = preset?.hours ?? 24
    return {
      window: { fromMs: nowMs - hours * HOUR_MS, toMs: nowMs },
      problem: null,
    }
  }
  if (range.from === '' || range.to === '') {
    return { window: null, problem: '请把开始与结束时间都选上' }
  }
  const fromMs = Date.parse(range.from)
  const toMs = Date.parse(range.to)
  if (Number.isNaN(fromMs) || Number.isNaN(toMs)) {
    return { window: null, problem: '时间格式不认识，请重新选一次' }
  }
  if (fromMs >= toMs) {
    return { window: null, problem: '开始时间必须早于结束时间' }
  }
  return { window: { fromMs, toMs }, problem: null }
}

/**
 * 窗口的两端换成 UTC RFC3339，直接喂给接口。
 * @param window 一段窗口
 */
export function toIsoWindow(window: TrendWindow): {
  since: string
  until: string
} {
  return {
    since: new Date(window.fromMs).toISOString(),
    until: new Date(window.toMs).toISOString(),
  }
}
