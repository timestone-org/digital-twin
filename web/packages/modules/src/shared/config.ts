/**
 * @fileoverview 模块配置的读取原语：`config` 到组件手里是 `Record<string, unknown>`，
 * 每个模块只读自己 `configSchema` 声明过的键，读出来立刻收窄成确定类型。
 */
import type { ConfigField } from '@dt/contracts'

/**
 * 文本。
 * @param raw 配置里读出来的原值
 * @param fallback 非字符串时的回退
 */
export function readText(raw: unknown, fallback = ''): string {
  return typeof raw === 'string' ? raw : fallback
}

/**
 * 布尔。⚠ 只认真正的 `true`：`'true'` 这种字符串一律按 false，
 * 否则「配置里存了字符串」这种脏数据会让开关看起来是开着的。
 * @param raw 配置里读出来的原值
 * @param fallback 非布尔时的回退
 */
export function readBoolean(raw: unknown, fallback = false): boolean {
  return typeof raw === 'boolean' ? raw : fallback
}

/**
 * 有限数；NaN 与 ±Infinity 按缺失处理。
 * @param raw 配置里读出来的原值
 * @param fallback 取不到有限数时的回退
 */
export function readNumber(raw: unknown, fallback: number): number {
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : fallback
}

/**
 * 去掉首尾空白的文本；非字符串走回落。
 * ⚠ 与 `readText` 的分工是刻意的：判「配了没有」必须用本函数，
 * 一串空格在 `readText` 眼里是有值的，于是标题条画出来却是空的。
 * @param raw 配置里读出来的原值
 * @param fallback 非字符串时的回退
 */
export function readTrimmedText(raw: unknown, fallback = ''): string {
  return typeof raw === 'string' ? raw.trim() : fallback
}

/**
 * 白名单枚举；不在名单里的一律回落。
 * ⚠ 只认字符串字面量，不做数字/布尔的字符串化：配置里存了 `1` 却在名单里
 * 匹配上 `'1'`，等于让脏数据挑走了一档语义。
 * @param raw 配置里读出来的原值
 * @param allowed 允许的取值，通常是模块自己的 `as const` 数组
 * @param fallback 不在名单里时的回退
 */
export function readEnum<T extends string>(
  raw: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return allowed.find((item) => item === raw) ?? fallback
}

/**
 * 宽口径的有限数：数字直取，非空数字串经 `Number` 收敛，其余一律 null。
 * ⚠ 只给**手写**的配置用（矩阵单元格、参考值这类经 JSON 粘贴的地方，带引号的数字很常见）；
 * 实时点位值一律走 `format.ts` 的 `toNumOrNull`，那条链路上的字符串是脏数据不是笔误。
 * @param raw 配置里读出来的原值
 */
export function readLooseNumber(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null
  if (typeof raw === 'string' && raw.trim() !== '') {
    const parsed = Number(raw)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

/**
 * 「留空 = 自动」的尺寸值：数字串收成数字，其余非空串原样透传；
 * 空值与既非数字也非字符串的脏值一律 undefined（= 交回自动）。
 * ⚠ 透传是有意的：echarts 的 grid 四边认百分比串（`5%`），值轴 min/max 认
 * `dataMin` / `dataMax`；收成数字会把这两种写法一起吃掉。
 * @param raw 配置里读出来的原值
 */
export function readSizeToken(raw: unknown): number | string | undefined {
  if (typeof raw !== 'number' && typeof raw !== 'string') return undefined
  const text = String(raw).trim()
  if (text === '') return undefined
  const parsed = Number(text)
  return Number.isFinite(parsed) ? parsed : text
}

function isRecord(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw)
}

function isUnknownArray(raw: unknown): raw is readonly unknown[] {
  return Array.isArray(raw)
}

/**
 * 子数组；非数组一律空数组。
 * ⚠ 元素仍是 `unknown`：`type: 'array'` 的每一行由模块自己按 `itemSchema` 逐键读回来，
 * 在这里假定行形状等于把校验挪到看不见的地方。
 * @param raw 配置里读出来的原值
 */
export function readArray(raw: unknown): readonly unknown[] {
  return isUnknownArray(raw) ? raw : []
}

/**
 * 子对象；数组与 null 都不算对象。
 * @param raw 配置里读出来的原值
 */
export function readRecord(raw: unknown): Record<string, unknown> {
  return isRecord(raw) ? raw : {}
}

/** 引用型缺省逐份复制，免得所有节点共享同一个对象、谁就地改一下全体跟着变。 */
function copy(value: unknown): unknown {
  return typeof value === 'object' && value !== null
    ? structuredClone(value)
    : value
}

/**
 * 把 `configSchema` 声明的缺省摊成一份配置。
 * ⚠ 只取字段自己的 `default`，不递归进 `fields`：`object` 字段声明的是**整块**缺省，
 * 再从子字段拼一份就有了第二个形状，两份必然漂。
 * @param fields 模块清单里的配置字段
 */
export function configDefaults(
  fields: readonly ConfigField[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const field of fields) {
    if (field.default !== undefined) out[field.key] = copy(field.default)
  }
  return out
}
