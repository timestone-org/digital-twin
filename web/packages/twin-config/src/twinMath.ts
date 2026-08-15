/**
 * @fileoverview 把绑定值缝合回配置的纯数学：数组行按文档序对齐成 id 映射、
 * 锚点读数格式化。无 Vue、无 three、无 DOM。
 */
import type { TwinRowSlot } from './constants'
import type { FlatHierField } from './hierTree'
import type { FlatPanelField } from './normalizeElements'
import { finiteValue, isRecord, toArray, toFiniteNumber } from './sanitize'
import type {
  TwinAnchor,
  TwinAnchorValue,
  TwinAnchorValues,
  TwinArrow,
  TwinArrowValue,
  TwinArrowValues,
  TwinFlowLink,
  TwinFlowValue,
  TwinFlowValues,
  TwinHierValue,
  TwinHierValues,
  TwinPanelValue,
  TwinPanelValues,
} from './types'

/**
 * 无值时的稳定空引用。
 * ⚠ 每帧新建一个空对象，会让下游 watch 每帧都触发一次——大屏其它槽有新值时，
 * 一个一个绑定都没配的孪生模块也会跟着空转重算。
 */
export const EMPTY_ANCHOR_VALUES: TwinAnchorValues = Object.freeze({})
export const EMPTY_PANEL_VALUES: TwinPanelValues = Object.freeze({})
export const EMPTY_ARROW_VALUES: TwinArrowValues = Object.freeze({})
export const EMPTY_FLOW_VALUES: TwinFlowValues = Object.freeze({})
export const EMPTY_HIER_VALUES: TwinHierValues = Object.freeze({})

/** 第 index 行的 sub 子槽；行不是对象一律按无值处理。 */
function readRowSlot(rows: unknown, index: number, sub: TwinRowSlot): unknown {
  const row = toArray(rows)[index]
  return isRecord(row) ? finiteValue(row[sub]) : undefined
}

/**
 * 锚点数组行 → 锚点 id 映射，第 i 行对应文档序第 i 个锚点。
 * ⚠ `anchors` 必须是 `normalizeTwinConfig` 的输出：派生绑定行与这里读值用同一个下标，
 * 喂原始配置会因为脏条目被丢弃而整体错位一格。
 * @param anchors 归一化后的锚点
 * @param rows 模块 values 里 `anchorValues` 槽的整个数组
 */
export function stitchAnchorValues(
  anchors: readonly TwinAnchor[] | undefined,
  rows: unknown,
): TwinAnchorValues {
  const out: Record<string, TwinAnchorValue> = {}
  ;(anchors ?? []).forEach((anchor, index) => {
    const value = readRowSlot(rows, index, 'value')
    if (value === undefined) return
    out[anchor.id] = { value }
  })
  return Object.keys(out).length === 0 ? EMPTY_ANCHOR_VALUES : out
}

/**
 * 箭头数组行 → 箭头 id 映射，第 i 行对应文档序第 i 个箭头。
 * @param arrows 归一化后的箭头
 * @param rows 模块 values 里 `arrowValues` 槽的整个数组
 */
export function stitchArrowValues(
  arrows: readonly TwinArrow[] | undefined,
  rows: unknown,
): TwinArrowValues {
  const out: Record<string, TwinArrowValue> = {}
  ;(arrows ?? []).forEach((arrow, index) => {
    const value = readRowSlot(rows, index, 'value')
    if (value === undefined) return
    out[arrow.id] = { value }
  })
  return Object.keys(out).length === 0 ? EMPTY_ARROW_VALUES : out
}

/**
 * 信息牌字段数组行 → `<牌 id>::<字段 key>` 映射。
 * ⚠ 行号是**扁平化后**的文档序，必须喂 `flattenPanelFields` 的输出：
 * 按「第 i 张牌」对齐会让多字段的牌之后的每一行整体错位。
 * @param fields `flattenPanelFields` 的输出
 * @param rows 模块 values 里 `panelValues` 槽的整个数组
 */
export function stitchPanelValues(
  fields: readonly FlatPanelField[] | undefined,
  rows: unknown,
): TwinPanelValues {
  const out: Record<string, TwinPanelValue> = {}
  ;(fields ?? []).forEach((entry, index) => {
    const value = readRowSlot(rows, index, 'value')
    if (value === undefined) return
    out[entry.valueKey] = { value }
  })
  return Object.keys(out).length === 0 ? EMPTY_PANEL_VALUES : out
}

/**
 * 能量流数组行 → 流 id 映射，第 i 行对应文档序第 i 条流。
 * ⚠ 两个子槽只要有一个有值就产出条目：只绑了强度没绑激活是常见配法，
 * 要求两个都有会让那条流永远静止。
 * @param flows 归一化后的能量流
 * @param rows 模块 values 里 `flowValues` 槽的整个数组
 */
export function stitchFlowValues(
  flows: readonly TwinFlowLink[] | undefined,
  rows: unknown,
): TwinFlowValues {
  const out: Record<string, TwinFlowValue> = {}
  ;(flows ?? []).forEach((flow, index) => {
    const intensity = readRowSlot(rows, index, 'intensity')
    const active = readRowSlot(rows, index, 'active')
    if (intensity === undefined && active === undefined) return
    out[flow.id] = { intensity, active }
  })
  return Object.keys(out).length === 0 ? EMPTY_FLOW_VALUES : out
}

/**
 * 钻取字段数组行 → `<节点 id>::<字段 key>` 映射。
 * ⚠ 行号是**扁平化后**的文档序，必须喂 `flattenHierFields` 的输出：
 * 按「第 i 个节点」对齐会让多字段的节点之后的每一行整体错位。
 * @param fields `flattenHierFields` 的输出
 * @param rows 模块 values 里 `hierValues` 槽的整个数组
 */
export function stitchHierValues(
  fields: readonly FlatHierField[] | undefined,
  rows: unknown,
): TwinHierValues {
  const out: Record<string, TwinHierValue> = {}
  ;(fields ?? []).forEach((entry, index) => {
    const value = readRowSlot(rows, index, 'value')
    if (value === undefined) return
    out[entry.valueKey] = { value }
  })
  return Object.keys(out).length === 0 ? EMPTY_HIER_VALUES : out
}

function formatReading(value: unknown, decimals: number | null): string {
  if (typeof value === 'boolean') return String(value)
  const parsed = toFiniteNumber(value)
  if (parsed === null) return typeof value === 'string' ? value.trim() : ''
  // ⚠ 后端的精确小数是字符串：不定位数时原样上屏，走一趟 Number 会丢精度
  if (decimals === null) {
    return typeof value === 'string' ? value.trim() : String(parsed)
  }
  return parsed.toFixed(decimals)
}

/** 拼一段读数所需的三样：前缀、单位、小数位。 */
export interface ValueFormat {
  prefix: string
  unit: string
  decimals: number | null
}

/**
 * `前缀 数值 单位` 三段按需拼接，空的那段不占位。
 * ⚠ 先过 `finiteValue`：NaN / ±Infinity 会被原样上屏分支逐字打印成 "NaN"。
 * @param format 前缀、单位与小数位
 * @param value 实时值
 */
export function formatValueText(format: ValueFormat, value: unknown): string {
  const reading = formatReading(finiteValue(value), format.decimals)
  return [format.prefix, reading, format.unit]
    .filter((part) => part !== '')
    .join(' ')
}

/**
 * 箭头标签文本：固定文案与读数之间空一格，两者都空时给空串。
 * @param arrow 归一化后的箭头
 * @param value 该箭头的实时值
 */
export function formatArrowText(arrow: TwinArrow, value: unknown): string {
  const reading = formatValueText(arrow, value)
  return [arrow.labelText, reading].filter((part) => part !== '').join(' ')
}

/**
 * 锚点标签文本，`label 数值 unit` 三段按需拼接。
 * ⚠ 先过 `finiteValue`：NaN / ±Infinity 会被下面的原样上屏分支逐字打印成 "NaN"。
 * @param anchor 归一化后的锚点
 * @param value 该锚点的实时值
 */
export function formatAnchorText(anchor: TwinAnchor, value: unknown): string {
  // 锚点的 label 就是别处的 prefix：同一套拼装，两处各写一份必漂
  return formatValueText(
    { prefix: anchor.label, unit: anchor.unit, decimals: anchor.decimals },
    value,
  )
}
