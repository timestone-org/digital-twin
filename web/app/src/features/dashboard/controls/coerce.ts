/**
 * @fileoverview 配置控件的取值归一：清单声明是什么类型，控件就按什么类型读，
 * 读不出来就回落到该档的空值。
 * ⚠ 脏值回落而不是抛：一份手写的（或旧版本的）配置里出现类型不对的键是常事，
 * 抛出去会让整个属性面板打不开，而用户要的只是把那一个字段改回来。
 */
import type { ConfigField, DtNumberRange, DtSelectOption } from '@dt/contracts'

/** 数组字段的行，非数组一律空表。 */
export function asRows(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

/**
 * 选项取值 → 下拉用的字符串键。
 * ⚠ 只认原始值：对象直接给空串，不许走默认字符串化——`[object Object]` 会让
 * 两个不同的对象选项共用一个键，选了 A 回显成 B。
 */
export function optionKey(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  return ''
}

/** `enum` 字段的选项。取值一律转成字符串键，`DtSelect` 只吃字符串。 */
export function optionsOf(field: ConfigField): DtSelectOption[] {
  return (field.options ?? []).map((option) => ({
    value: optionKey(option.value),
    label: option.label,
  }))
}

/** 按字符串键回找原始取值：选项的 value 可以是数字或布尔。 */
export function optionValueOf(field: ConfigField, raw: string): unknown {
  const hit = (field.options ?? []).find(
    (option) => optionKey(option.value) === raw,
  )
  return hit === undefined ? raw : hit.value
}

/** 数值字段的上下限与步长。 */
export function rangeOf(field: ConfigField): DtNumberRange {
  const range: DtNumberRange = {}
  if (field.min !== undefined) range.min = field.min
  if (field.max !== undefined) range.max = field.max
  if (field.step !== undefined) range.step = field.step
  return range
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 改多键值形状（字体、样式槽）里的一个子键：给了值就写，没设置就把这个键**删掉**。
 * ⚠ 删而不是留 `undefined`：`{ size: undefined }` 落库后是一个存在的键，
 * 而这些形状的渲染端按「键在不在」决定跟不跟随主题，物化出来的空键会被
 * 认成「配过了」，主题再怎么换这一项都不动。
 */
export function patchKey(
  base: Record<string, unknown>,
  key: string,
  next: unknown,
): Record<string, unknown> {
  const merged = { ...base }
  if (next === undefined || next === null || next === '') {
    delete merged[key]
    return merged
  }
  merged[key] = next
  return merged
}

/** 值形状上某个子键的字符串，读不出来给空串。 */
export function subText(value: Record<string, unknown>, key: string): string {
  const raw = value[key]
  return typeof raw === 'string' ? raw : ''
}

/**
 * 值形状上某个子键的有限数。
 * ⚠ 读不出来给 `undefined` 而不是 0：0 是合法字号与合法不透明度，
 * 拿它冒充「没配」会让数值框把一个空键显示成实配的 0。
 */
export function subNumber(
  value: Record<string, unknown>,
  key: string,
): number | undefined {
  const raw = value[key]
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : undefined
}

/** 一行数组项的标题：优先取 `itemLabelKey` 指的那个子字段。 */
export function rowLabel(field: ConfigField, row: unknown, at: number): string {
  const key = field.itemLabelKey
  if (key !== undefined && isRecord(row)) {
    const text = row[key]
    if (typeof text === 'string' && text !== '') return text
  }
  return `第 ${at + 1} 项`
}
