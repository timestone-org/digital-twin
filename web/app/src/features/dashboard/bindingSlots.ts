/**
 * @fileoverview 绑定槽在面板上摊成几行：普通槽一行，数组槽 N 行 × 每行若干子槽。
 * 落库形状 `rows[0].value` 见 docs/DASHBOARD_DESIGN.md §4.2。
 *
 * ⚠ 行号必须**连续且从 0 起**，服务端会校验。所以「删中间一行」是把它后面的
 * 整体前移一格，不是留个洞——留洞的话保存时整批被拒，而拒的原因看着与这次操作无关。
 */
import type { BindingPayload, BindingSpec } from '@dt/contracts'

/** 面板上的一个可绑位置。 */
export interface BindingSlotRow {
  /** 落库的 `fieldKey`。 */
  fieldKey: string
  /** 这个位置的槽声明（数组槽落到行内子槽上）。 */
  spec: BindingSpec
  /** 数组槽的行号，普通槽没有。 */
  rowIndex?: number
}

/** 数组槽第 index 行、子槽 sub 的 fieldKey。 */
export function rowFieldKey(
  slotKey: string,
  index: number,
  sub: string,
): string {
  return `${slotKey}[${index}].${sub}`
}

/** 一个数组槽当前有几行：按已有绑定里出现过的最大行号 + 1。 */
export function arrayRowCount(
  bindings: readonly BindingPayload[],
  slotKey: string,
): number {
  const prefix = `${slotKey}[`
  let top = -1
  for (const binding of bindings) {
    if (!binding.fieldKey.startsWith(prefix)) continue
    const closing = binding.fieldKey.indexOf(']', prefix.length)
    if (closing < 0) continue
    const index = Number(binding.fieldKey.slice(prefix.length, closing))
    if (Number.isInteger(index) && index > top) top = index
  }
  return top + 1
}

/**
 * 一个槽声明摊成面板上的若干行。
 * @param spec 槽声明
 * @param rowCount 数组槽的行数，普通槽忽略
 */
export function slotRows(
  spec: BindingSpec,
  rowCount: number,
): BindingSlotRow[] {
  if (spec.isArray !== true) return [{ fieldKey: spec.key, spec }]
  const subs = spec.arrayFields ?? []
  const rows: BindingSlotRow[] = []
  for (let index = 0; index < rowCount; index += 1) {
    for (const sub of subs) {
      rows.push({
        fieldKey: rowFieldKey(spec.key, index, sub.key),
        spec: sub,
        rowIndex: index,
      })
    }
  }
  return rows
}

/**
 * 删掉数组槽的第 index 行，其后各行整体前移一格。
 * @param bindings 该节点全部绑定
 * @param slotKey 数组槽键
 * @param index 要删的行号
 */
export function withRowRemoved(
  bindings: readonly BindingPayload[],
  slotKey: string,
  index: number,
): BindingPayload[] {
  const prefix = `${slotKey}[`
  const kept: BindingPayload[] = []
  for (const binding of bindings) {
    if (!binding.fieldKey.startsWith(prefix)) {
      kept.push(binding)
      continue
    }
    const closing = binding.fieldKey.indexOf(']', prefix.length)
    const at = Number(binding.fieldKey.slice(prefix.length, closing))
    if (at === index) continue
    if (at < index) {
      kept.push(binding)
      continue
    }
    // ⚠ 从 `]` 开始接回去：从 `closing + 1` 接会把右括号一起吃掉，
    // 拼出来的 `rows[0.value` 在服务端是一条谁也匹配不上的槽键
    kept.push({
      ...binding,
      fieldKey: `${prefix}${at - 1}${binding.fieldKey.slice(closing)}`,
    })
  }
  return kept
}

/** 面板上的一组：普通槽只有一组，数组槽每行一组。 */
export interface BindingSlotGroup {
  /** 组标题；普通槽没有。 */
  title: string | null
  /** 数组槽的行号；普通槽没有。 */
  rowIndex: number | null
  rows: readonly BindingSlotRow[]
}

/**
 * 一个槽声明摊成面板上的若干组。
 * @param spec 槽声明
 * @param rowCount 数组槽的行数
 */
export function slotGroups(
  spec: BindingSpec,
  rowCount: number,
): BindingSlotGroup[] {
  if (spec.isArray !== true) {
    return [{ title: null, rowIndex: null, rows: slotRows(spec, 0) }]
  }
  const groups: BindingSlotGroup[] = []
  for (let index = 0; index < rowCount; index += 1) {
    groups.push({
      title: `第 ${index + 1} 行`,
      rowIndex: index,
      rows: (spec.arrayFields ?? []).map((sub) => ({
        fieldKey: rowFieldKey(spec.key, index, sub.key),
        spec: sub,
        rowIndex: index,
      })),
    })
  }
  return groups
}
