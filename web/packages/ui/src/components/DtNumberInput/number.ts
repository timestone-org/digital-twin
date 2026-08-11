/**
 * @fileoverview DtNumberInput 的取值换算：解析、夹取、定点舍入与步进。
 * 抽出来是为了能单测——组件只能挂载着测，浮点边界在那一层看不清。
 */
import type { DtNumberRange } from '@dt/contracts'

export const DEFAULT_STEP = 1
// 十进制舍入的位数上限：再多就超出 double 的有效精度，10 ** d 自己先失真
const MAX_DECIMALS = 15

/**
 * 把输入框里的文本读成数字；空串与解析不出的一律 undefined。
 * @param text 输入框当前文本
 */
export function parseInput(text: string): number | undefined {
  const trimmed = text.trim()
  if (trimmed === '') return undefined
  const value = Number(trimmed)
  // ⚠ 必须用 isFinite 而不是 isNaN：'Infinity' 能被 Number 解析出来，
  // 放过去之后 toFixed 会抛 RangeError，输入框直接白屏。
  return Number.isFinite(value) ? value : undefined
}

/**
 * 夹到上下限之内。
 * @param value 待夹取的值
 * @param range 取值域
 */
export function clamp(value: number, range: DtNumberRange): number {
  const { min, max } = range
  if (min !== undefined && value < min) return min
  if (max !== undefined && value > max) return max
  return value
}

/** 十进制小数位数，认得 `1e-7` 这种科学计数法。 */
function decimalsOf(value: number): number {
  if (!Number.isFinite(value)) return 0
  const match = /(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(String(value))
  const fraction = match?.[1]?.length ?? 0
  const exponent = Number(match?.[2] ?? 0)
  return Math.max(0, fraction - exponent)
}

function roundTo(value: number, decimals: number): number {
  const scale = 10 ** Math.min(decimals, MAX_DECIMALS)
  return Math.round(value * scale) / scale
}

/**
 * 按 `precision` 定点舍入；没给就原样返回。
 * @param value 待舍入的值
 * @param range 取值域
 */
export function applyPrecision(value: number, range: DtNumberRange): number {
  const { precision } = range
  return precision === undefined ? value : roundTo(value, precision)
}

/**
 * 落定值：先定点舍入再夹取。
 * @param value 待归一的原始值
 * @param range 取值域
 */
export function normalize(value: number, range: DtNumberRange): number {
  return clamp(applyPrecision(value, range), range)
}

/**
 * 渲染成输入框文本；`precision` 决定补几位小数。
 * @param value 当前值，缺省或 NaN 渲染成空串
 * @param range 取值域
 */
export function formatValue(
  value: number | undefined,
  range: DtNumberRange,
): string {
  if (value === undefined || !Number.isFinite(value)) return ''
  const { precision } = range
  return precision === undefined ? String(value) : value.toFixed(precision)
}

/**
 * 步进一格并归一。
 * @param base 步进基准
 * @param direction 1 增、-1 减
 * @param range 取值域
 */
export function stepFrom(
  base: number,
  direction: 1 | -1,
  range: DtNumberRange,
): number {
  const step = range.step ?? DEFAULT_STEP
  const next = base + direction * step
  if (range.precision !== undefined) return normalize(next, range)
  // ⚠ 无 precision 时按基准与步长的小数位数收一次：不收的话 0.2 + 0.1
  // 会落成 0.30000000000000004，而它会原样显示在输入框里。
  const decimals = Math.max(decimalsOf(base), decimalsOf(step))
  return clamp(roundTo(next, decimals), range)
}
