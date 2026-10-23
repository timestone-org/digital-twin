/** @fileoverview 自然日边界按明确的 IANA 时区解析，不使用浏览器本地时区。 */

export const DEFAULT_CALENDAR_TIMEZONE = 'Asia/Shanghai'

function dayFormatter(timezone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
}

/** 判断采样时刻是否属于当前自然日，未来值不作为当前累计展示。 */
export function isCurrentCalendarDay(
  timestampMs: number,
  nowMs: number,
  timezone = DEFAULT_CALENDAR_TIMEZONE,
): boolean {
  const formatter = dayFormatter(timezone)
  return (
    Number.isFinite(timestampMs) &&
    timestampMs <= nowMs &&
    formatter.format(timestampMs) === formatter.format(nowMs)
  )
}

/** 找到当前自然日的首个毫秒，夏令时日不按固定 24 小时倒推。 */
export function calendarDayStart(
  nowMs: number,
  timezone = DEFAULT_CALENDAR_TIMEZONE,
): number {
  const formatter = dayFormatter(timezone)
  const day = formatter.format(nowMs)
  let left = nowMs - 36 * 3_600_000
  let right = nowMs
  while (left < right) {
    const middle = Math.floor((left + right) / 2)
    if (formatter.format(middle) === day) right = middle
    else left = middle + 1
  }
  return left
}
