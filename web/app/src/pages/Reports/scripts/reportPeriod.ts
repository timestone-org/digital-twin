/** @fileoverview 按报告粒度和业务时区生成当前报告期。 */
import type { ReportTemplate } from '@dt/contracts'

type CalendarPart = 'year' | 'month' | 'day'

function part(parts: Intl.DateTimeFormatPart[], type: CalendarPart): string {
  const value = parts.find((item) => item.type === type)?.value
  if (value === undefined) throw new RangeError(`报告期缺少 ${type}`)
  return value
}

/**
 * 格式化业务时区下的当前报告期。
 * @param granularity 报告粒度
 * @param timezone IANA 业务时区
 * @param at 参照时刻
 */
export function currentReportPeriod(
  granularity: ReportTemplate['granularity'],
  timezone: string,
  at: Date,
): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(at)
  const year = part(parts, 'year')
  const month = part(parts, 'month')
  if (granularity === 'year') return year
  if (granularity === 'quarter')
    return `${year}Q${Math.floor((Number(month) - 1) / 3) + 1}`
  if (granularity === 'month') return `${year}-${month}`
  return `${year}-${month}-${part(parts, 'day')}`
}
