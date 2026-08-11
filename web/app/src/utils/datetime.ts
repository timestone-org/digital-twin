/**
 * @fileoverview 时刻的展示格式化。
 * ⚠ 集中在一处：散落的格式化会让同一个时刻在两张表里显示成两种样子。
 */

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
 * 常驻时钟的时分秒。
 * @param at 要渲染的时刻，缺省取当前
 */
export function formatTimeOfDay(at: Date = new Date()): string {
  return at.toLocaleTimeString('zh-CN', { hour12: false })
}

/**
 * 常驻时钟的日期。
 * @param at 要渲染的时刻，缺省取当前
 */
export function formatDate(at: Date = new Date()): string {
  return at.toLocaleDateString('zh-CN')
}
