/**
 * @fileoverview 原始 JSON 值的清洗原语：非有限数、数字、字符串、颜色规格。
 * 归一化（types.ts）与渲染派生（twinMath.ts）共用同一套口径，两边各写一份必然漂。
 */

/** 三位或六位十六进制色 */
const HEX_COLOR_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i
/** `var(--x)` 包装 */
const CSS_VAR_RE = /^var\(\s*(--[a-z0-9-]+)\s*\)$/i
/** 裸 token 名 */
const TOKEN_RE = /^--[a-z0-9-]+$/i
/** 缩写 hex 的位数 */
const SHORTHAND_HEX_LENGTH = 3

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

/**
 * 非有限数（NaN / ±Infinity）视同无值 → `undefined`；其余（含合法 0、null、字符串）原样。
 * ⚠ 任何值进格式化之前都要先过它：格式化对非数值走「原样上屏」分支，
 * NaN 会被逐字打印成锚点上的 "NaN"，全程没有任何报错。
 */
export function finiteValue(value: unknown): unknown {
  return typeof value === 'number' && !Number.isFinite(value)
    ? undefined
    : value
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

/** 取有限数，取不到用 fallback 顶上。 */
export function finiteOr(value: unknown, fallback: number): number {
  return toFiniteNumber(value) ?? fallback
}

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

/** 归一为小写 `#rrggbb`；非法 → null。 */
export function normalizeHexColor(value: unknown): string | null {
  const matched = HEX_COLOR_RE.exec(trimmedString(value))
  if (matched === null) return null
  const digits = matched[1] ?? ''
  const full =
    digits.length === SHORTHAND_HEX_LENGTH
      ? [...digits].map((char) => char + char).join('')
      : digits
  return `#${full.toLowerCase()}`
}

/**
 * 颜色规格：`#rrggbb` 或 `--token`（`var(--x)` 剥成 `--x`）；其余 → null。
 * ⚠ token 的取值要到有 CSS 级联的宿主里才解析得出来，本包只认形状不认值。
 */
export function normalizeColorSpec(value: unknown): string | null {
  const text = trimmedString(value)
  const hex = normalizeHexColor(text)
  if (hex !== null) return hex
  const wrapped = CSS_VAR_RE.exec(text)
  if (wrapped !== null) return (wrapped[1] ?? '').toLowerCase()
  return TOKEN_RE.test(text) ? text.toLowerCase() : null
}
