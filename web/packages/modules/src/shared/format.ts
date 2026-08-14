/**
 * @fileoverview 模块展示层的数值格式化。
 * ⚠ 全套函数只有一条铁律：缺值渲染「—」，绝不伪造 0——大屏上「0」与「没数据」
 * 长得一样时，停机与归零就再也分不出来（DASHBOARD_DESIGN §4.3）。
 */

/** 无数据占位符，全平台统一。 */
export const NO_DATA = '—'

// Intl 与 toFixed 只接受 [0, 100] 的小数位，越界直接抛 RangeError
const MIN_DIGITS = 0
const MAX_DIGITS = 100
// 压缩到「k」的门槛
const KILO = 1000

/**
 * 是不是一个能拿来显示的有限数。真实 0 算，NaN / ±Infinity / null 都不算。
 * @param raw 待判定的原值
 */
export function isPresent(raw: unknown): raw is number {
  return typeof raw === 'number' && Number.isFinite(raw)
}

/**
 * 取有限数，取不到给 null。
 * @param raw 待转换的原值
 */
export function toNumOrNull(raw: unknown): number | null {
  return isPresent(raw) ? raw : null
}

/**
 * 小数位钳到合法区间。
 * ⚠ 位数是配置驱动的，用户填个负数或 200 都合法地存得下来，不钳就是运行时抛错。
 * @param digits 配置里来的小数位
 * @param fallback 非有限数时的回退
 */
function clampDigits(digits: number, fallback: number): number {
  return Number.isFinite(digits)
    ? Math.min(MAX_DIGITS, Math.max(MIN_DIGITS, digits))
    : fallback
}

/**
 * 定点小数，缺值给「—」。
 * @param raw 待格式化的原值
 * @param digits 小数位
 */
export function fmtFixed(raw: unknown, digits = 0): string {
  return isPresent(raw) ? raw.toFixed(clampDigits(digits, 0)) : NO_DATA
}

/** ⚠ -0 归一成 0：不归一的话大屏上会显出「-0」，看着像个坏值。 */
function unsignZero(value: number): number {
  return value === 0 ? 0 : value
}

/**
 * 千分位数值，缺值给「—」。
 * @param raw 待格式化的原值
 * @param precision 最多几位小数，≤0 时先四舍五入到整数
 */
export function fmtNumber(raw: unknown, precision = 2): string {
  if (!isPresent(raw)) return NO_DATA
  const value = unsignZero(raw)
  const digits = clampDigits(precision, 2)
  return digits <= 0
    ? Math.round(value).toLocaleString('en-US')
    : value.toLocaleString('en-US', { maximumFractionDigits: digits })
}

/**
 * 去尾随零、不带千分位的数值，缺值给「—」。坐标与轴标签用这一档。
 * @param raw 待格式化的原值
 * @param max 最多几位小数
 */
export function fmtTrim(raw: unknown, max = 2): string {
  if (!isPresent(raw)) return NO_DATA
  return unsignZero(raw).toLocaleString('en-US', {
    maximumFractionDigits: clampDigits(max, 2),
    useGrouping: false,
  })
}

/**
 * 电量读数：绝对值取整后 ≥1000 压成「x.xxk」，否则显整数，缺值给「—」。
 * ⚠ 判档用的是**取整后**的绝对值：999.6 与 1000 因此同显「1k」，
 * 否则同一屏上会并排出现「1000」和「1k」两种写法。
 * @param raw 待格式化的原值
 * @param precision 压缩档保留几位小数
 */
export function fmtKwh(raw: unknown, precision = 2): string {
  if (!isPresent(raw)) return NO_DATA
  const sign = raw < 0 ? '-' : ''
  const abs = Math.abs(raw)
  return Math.round(abs) >= KILO
    ? `${sign}${fmtTrim(abs / KILO, precision)}k`
    : `${sign}${fmtTrim(abs, 0)}`
}
