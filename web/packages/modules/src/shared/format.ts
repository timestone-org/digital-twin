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

/**
 * 定点小数，位数固定；`grouping` 决定要不要千分位。缺值给「—」。
 * ⚠ 与 `fmtNumber` 的分工是刻意的：那一档是「最多几位」，尾随零会被抹掉，
 * 于是同一列里 63.40 与 63.4 并排出现，看着像两个精度不同的表。仪表读数要的是
 * 逐行对齐，故这一档补零。
 * @param raw 待格式化的原值
 * @param digits 小数位
 * @param grouping 整数部分要不要千分位
 */
export function fmtDecimal(raw: unknown, digits = 1, grouping = false): string {
  if (!isPresent(raw)) return NO_DATA
  const fixed = clampDigits(digits, 1)
  return unsignZero(raw).toLocaleString('en-US', {
    minimumFractionDigits: fixed,
    maximumFractionDigits: fixed,
    useGrouping: grouping,
  })
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

/**
 * 采样时刻 → 本地时的 `HH:mm:ss`，缺值给「—」。
 * ⚠ 到**秒**而不是到分：本仓的点位周期低到 10 秒，按分钟显示时「还在动」与
 * 「一分钟前就停了」是同一个字样，而这一列存在的全部意义就是分开这两件事。
 * ⚠ 只格式化、不判新旧：值有多旧由看的人决定，不在这里降档
 * （DASHBOARD_DESIGN §4.3）。
 * @param epochMs 采样时刻，UTC 毫秒
 */
export function fmtClock(epochMs: unknown): string {
  if (!isPresent(epochMs)) return NO_DATA
  const at = new Date(epochMs)
  if (Number.isNaN(at.getTime())) return NO_DATA
  return `${pad2(at.getHours())}:${pad2(at.getMinutes())}:${pad2(at.getSeconds())}`
}
