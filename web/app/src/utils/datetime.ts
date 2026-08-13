/**
 * @fileoverview 时刻的展示格式化。
 * ⚠ 集中在一处：散落的格式化会让同一个时刻在两张表里显示成两种样子。
 */

import { formatLocalMinute } from '@dt/ui'

/**
 * 后端给的一律是 UTC RFC3339，这里按浏览器时区渲染。
 * @param value 时刻字符串，`null` 表示取值缺席
 * @param empty 取值缺席时的占位符，缺省一个破折号
 */
export function formatDateTime(value: string | null, empty = '—'): string {
  if (value === null) return empty
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return '—'
  return parsed.toLocaleString('zh-CN', { hour12: false })
}

/**
 * 本地时的 `YYYY-MM-DD HH:mm`。⚠ 换算走 `@dt/ui` 那一份，不在这里重写：
 * 不带时区的字面量按本地时解析，各写一遍必然静默差出一个时区。
 * @param value 时刻字符串，`null` 表示取值缺席
 * @param empty 取值缺席时的占位符
 */
export function formatMinuteStamp(value: string | null, empty = '—'): string {
  if (value === null) return empty
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return '—'
  return formatLocalMinute(parsed.getTime())
}

/**
 * 本地时的 `YYYY-MM-DD`。
 * @param value 时刻字符串，`null` 表示取值缺席
 * @param empty 取值缺席时的占位符
 */
export function formatDay(value: string | null, empty = '—'): string {
  const stamp = formatMinuteStamp(value, empty)
  return stamp === empty || stamp === '—' ? stamp : stamp.slice(0, 10)
}

/**
 * 本地时的 `MM-DD`，给窄格子用。
 * @param value 时刻字符串，`null` 表示取值缺席
 */
export function formatMonthDay(value: string | null): string {
  const day = formatDay(value)
  return day === '—' ? day : day.slice(5)
}

// 相对时间的三档进位：一分钟以内算「刚刚」，之后按分、时、天
const SECOND_MS = 1000
const MINUTE_MS = 60 * SECOND_MS
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

/**
 * 距今多久。
 * ⚠ 未来时刻（服务端与浏览器的时钟偏差）一律算「刚刚」，不写「-1 分钟前」。
 * @param value 过去的某个时刻，UTC RFC3339
 * @param now 参照时刻，缺省取当前
 */
export function formatSince(value: string, now: Date = new Date()): string {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return '—'
  const elapsed = now.getTime() - parsed.getTime()
  if (elapsed < MINUTE_MS) return '刚刚'
  if (elapsed < HOUR_MS) return `${Math.floor(elapsed / MINUTE_MS)} 分钟前`
  if (elapsed < DAY_MS) return `${Math.floor(elapsed / HOUR_MS)} 小时前`
  return `${Math.floor(elapsed / DAY_MS)} 天前`
}

/**
 * 常驻时钟的时分秒。
 * @param at 要渲染的时刻，缺省取当前
 */
export function formatTimeOfDay(at: Date = new Date()): string {
  return at.toLocaleTimeString('zh-CN', { hour12: false })
}

/**
 * UTC RFC3339 → 本地时的时分秒。
 * @param value 时刻字符串
 */
export function formatTimeAt(value: string): string {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return '—'
  return formatTimeOfDay(parsed)
}

/**
 * 常驻时钟的日期。
 * @param at 要渲染的时刻，缺省取当前
 */
export function formatDate(at: Date = new Date()): string {
  return at.toLocaleDateString('zh-CN')
}
