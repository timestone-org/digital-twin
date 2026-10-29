/** @fileoverview 能管参数联动与时间写法的即时校验。 */
export const BDM_MINUTE_INTERVALS = [
  1, 2, 3, 4, 5, 6, 10, 12, 15, 20, 30, 60,
] as const
export const BDM_RECENT_RANGES = [
  { value: '-1h', label: '最近 1 小时' },
  { value: '-6h', label: '最近 6 小时' },
  { value: '-12h', label: '最近 12 小时' },
  { value: '-1d', label: '最近 1 天' },
  { value: '-7d', label: '最近 7 天' },
  { value: '-30d', label: '最近 30 天' },
  { value: '-90d', label: '最近 90 天' },
  { value: '-365d', label: '最近 365 天' },
]

export function changeBdmConfig(
  config: Record<string, unknown>,
  key: string,
  value: unknown,
): Record<string, unknown> {
  const next = { ...config, [key]: value }
  if (key === 'kind' && config['kind'] !== value) next['identifiers'] = []
  if ((key === 'kind' || key === 'granularity') && config[key] !== value)
    next['interval_minutes'] = null
  return next
}

export function bdmText(
  config: Record<string, unknown>,
  key: string,
  fallback: string,
): string {
  const value = config[key]
  return typeof value === 'string' ? value : fallback
}

function timeOf(value: string, now: number): number {
  const relative = /^-(\d{1,6})([mhdw])$/.exec(value)
  if (relative) {
    const units: Record<string, number> = {
      m: 60,
      h: 3600,
      d: 86400,
      w: 604800,
    }
    return now - Number(relative[1]) * (units[relative[2] ?? ''] ?? 0) * 1000
  }
  return /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    ? Date.parse(value)
    : Number.NaN
}

export function bdmTimeError(config: Record<string, unknown>): string {
  const since = bdmText(config, 'since', '-7d').trim()
  const until = bdmText(config, 'until', '').trim()
  if (!since) return '请填写起始时刻；能管取数不支持无起点查询'
  const now = Date.now()
  const start = timeOf(since, now)
  const end = until ? timeOf(until, now) : now
  if (!Number.isFinite(start) || !Number.isFinite(end))
    return '时间请使用日期选择器，或填写 -30m、-12h、-7d、-4w'
  if (start >= end) return '起始时刻必须早于截止时刻'
  return ''
}

export function bdmIntervalError(config: Record<string, unknown>): string {
  if (config['kind'] !== 'formula') return ''
  const value = config['interval_minutes']
  if (value === null || value === undefined) return ''
  const granularity = config['granularity'] ?? 'day'
  if (granularity === 'hour' && value === 60) return ''
  if (granularity !== 'minute')
    return '当前粒度不使用分钟间隔，请重新选择粒度以清空旧设置'
  return BDM_MINUTE_INTERVALS.some((item) => item === value)
    ? ''
    : '请选择支持的分钟间隔'
}
