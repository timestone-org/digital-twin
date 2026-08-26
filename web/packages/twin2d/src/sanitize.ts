/**
 * @fileoverview 原始 JSON 值的清洗原语：数、串、布尔、闭合取值域、长度与去重。
 * 归一化六件与渲染派生共用同一套口径，两边各写一份必然漂。
 */
import type { Twin2dLen } from './typesPrim'

/** 百分比长度 */
const PERCENT_LEN_RE = /^-?\d+(?:\.\d+)?%$/
/** em 长度 */
const EM_LEN_RE = /^-?\d+(?:\.\d+)?em$/

const EMPTY_ARRAY: readonly unknown[] = Object.freeze([])

/** 是不是一个普通对象（数组与 null 都不是）。 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// ⚠ 直接用 `Array.isArray` 会把 unknown 收窄成 any[]，取出来的元素绕过全部类型检查
function isUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value)
}

/** 数组原样返回，非数组返回同一个冻结空数组。 */
export function toArray(value: unknown): readonly unknown[] {
  return isUnknownArray(value) ? value : EMPTY_ARRAY
}

/** 宽松转数（含数字字符串）；非数或非有限 → null，与显式 0 区分得开。 */
export function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (text === '') return null
  const parsed = Number(text)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * 取有限数，取不到用 fallback 顶上。
 * @param value 原始值
 * @param fallback 取不到时的缺省
 */
export function finiteOr(value: unknown, fallback: number): number {
  return toFiniteNumber(value) ?? fallback
}

/**
 * 夹取到闭区间。
 * @param value 数值
 * @param lo 下界
 * @param hi 上界
 */
export function clamp(value: number, lo: number, hi: number): number {
  return value < lo ? lo : value > hi ? hi : value
}

/** 去空白的字符串；非字符串 → 空串。 */
export function trimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** 字符串数组：去空白、丢空串、按首次出现去重。 */
export function stringList(value: unknown): string[] {
  const seen = new Set<string>()
  for (const item of toArray(value)) {
    const text = trimmedString(item)
    if (text !== '') seen.add(text)
  }
  return [...seen]
}

/**
 * 尺寸类正数：必须 > 0，0 与负数一律回缺省。
 * ⚠ 0 会让整块塌掉且不报错——一个宽 0 的盒在 devtools 里看着一切正常。
 * @param value 原始值
 * @param fallback 不合法时的缺省
 */
export function posDim(value: unknown, fallback: number): number {
  const parsed = toFiniteNumber(value)
  return parsed === null || parsed <= 0 ? fallback : parsed
}

/**
 * 四舍五入取整并夹到闭区间；取不到数时回缺省（缺省不再夹取）。
 * @param value 原始值
 * @param lo 下界
 * @param hi 上界
 * @param fallback 取不到数时的缺省
 */
export function intIn(
  value: unknown,
  lo: number,
  hi: number,
  fallback: number,
): number {
  const parsed = toFiniteNumber(value)
  return parsed === null ? fallback : clamp(Math.round(parsed), lo, hi)
}

/**
 * 只认真正的布尔；`0` / `'true'` 这类一律回缺省。
 * @param value 原始值
 * @param fallback 非布尔时的缺省
 */
export function boolOr(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

/**
 * 闭合取值域白名单：命中原样返回，否则回缺省。
 * @param value 原始值
 * @param allowed 允许的取值，通常是 kinds.ts 里的常量数组
 * @param fallback 未命中时的缺省
 */
export function oneOf<T>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  const found = allowed.find((item) => item === value)
  return found === undefined ? fallback : found
}

/**
 * 实体 id：非空字符串取 trim 后的值，有限数字走 `String()`，其余 → 空串。
 * ⚠ 空串的语义是「这一条没有身份」，调用方要按「丢弃该条」处理——留着它会让
 * 补丁、连线端点、绑定行全部指向一个寻不到的东西，而三处都零报错。
 */
export function idOf(value: unknown): string {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : ''
  }
  return trimmedString(value)
}

/**
 * 按键去重：空键与重复键都丢弃，后来者丢弃。
 * @param items 原始条目
 * @param keyOf 取一条的身份键
 */
export function uniqueBy<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
): T[] {
  const seen = new Set<string>()
  const kept: T[] = []
  for (const item of items) {
    const key = keyOf(item)
    if (key === '' || seen.has(key)) continue
    seen.add(key)
    kept.push(item)
  }
  return kept
}

function isPercentLen(text: string): text is `${number}%` {
  return PERCENT_LEN_RE.test(text)
}

function isEmLen(text: string): text is `${number}em` {
  return EM_LEN_RE.test(text)
}

/** 是不是一个合法的 `Twin2dLen`（有限数、百分比、em 或 `auto`）。 */
export function isTwin2dLen(value: unknown): value is Twin2dLen {
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value !== 'string') return false
  return value === 'auto' || isPercentLen(value) || isEmLen(value)
}

/**
 * 取一个长度；裸数字串按设计像素收，其余不合口径的回缺省。
 * ⚠ 从 unknown 收窄到 `Twin2dLen` 只走这里：模板字面量类型没法用断言收窄，
 * 各处自己写正则必然漂出第四种串形（§4.2）。
 * @param value 原始值
 * @param fallback 不合口径时的缺省
 */
export function lenOr(value: unknown, fallback: Twin2dLen): Twin2dLen {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : fallback
  }
  const text = trimmedString(value)
  if (isTwin2dLen(text)) return text
  return toFiniteNumber(text) ?? fallback
}
