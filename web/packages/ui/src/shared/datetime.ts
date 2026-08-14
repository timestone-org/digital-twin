/**
 * @fileoverview 时刻的换算与格式化面：对外口径一律 UTC RFC3339，
 * 显示与原生控件一律本地时。散落着各写一遍是 8 小时偏差的来源。
 */

// `<input type="datetime-local">` 的取值形状：到分钟，不带秒与时区
const LOCAL_MINUTE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/

function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0')
}

/**
 * 取一个时刻的**本地**年月日时分，拼成 `YYYY-MM-DDTHH:mm`。
 * @param at 时刻
 */
export function localMinuteOf(at: Date): string {
  const day = `${pad(at.getFullYear(), 4)}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`
  return `${day}T${pad(at.getHours())}:${pad(at.getMinutes())}`
}

/**
 * UTC RFC3339 → 本地时的 `YYYY-MM-DDTHH:mm`；给不出取值时返回空串。
 * @param iso UTC RFC3339 时刻，空串表示没有取值
 */
export function toLocalMinuteInput(iso: string): string {
  if (iso === '') return ''
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return ''
  return localMinuteOf(at)
}

/**
 * 本地时的 `YYYY-MM-DDTHH:mm` → UTC RFC3339；形状不对时返回空串。
 * @param local 原生 datetime-local 控件的取值
 */
export function fromLocalMinuteInput(local: string): string {
  if (!LOCAL_MINUTE.test(local)) return ''
  // ⚠ 不带时区的 date-time 字面量按**本地时**解析（带 Z 的才按 UTC）：
  // 这一条就是本模块存在的理由，就地各写一遍必然静默差出一个时区
  const at = new Date(local)
  if (Number.isNaN(at.getTime())) return ''
  return at.toISOString()
}

/**
 * 毫秒时间戳 → 本地时的 `YYYY-MM-DD HH:mm`，给图表轴与 tooltip 用。
 * @param epochMs 毫秒时间戳
 */
export function formatLocalMinute(epochMs: number): string {
  if (!Number.isFinite(epochMs)) return ''
  return localMinuteOf(new Date(epochMs)).replace('T', ' ')
}
