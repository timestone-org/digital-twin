/**
 * @fileoverview 把绑定值缝合回配置的纯数学：数组行按文档序对齐成 id 映射、
 * 锚点读数格式化。无 Vue、无 three、无 DOM。
 */
import type { TwinRowSlot } from './constants'
import { finiteValue, isRecord, toArray, toFiniteNumber } from './sanitize'
import type { TwinAnchor, TwinAnchorValue, TwinAnchorValues } from './types'

/**
 * 无值时的稳定空引用。
 * ⚠ 每帧新建一个空对象，会让下游 watch 每帧都触发一次——大屏其它槽有新值时，
 * 一个一个绑定都没配的孪生模块也会跟着空转重算。
 */
export const EMPTY_ANCHOR_VALUES: TwinAnchorValues = Object.freeze({})

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

/**
 * 锚点标签文本，`label 数值 unit` 三段按需拼接。
 * ⚠ 先过 `finiteValue`：NaN / ±Infinity 会被下面的原样上屏分支逐字打印成 "NaN"。
 * @param anchor 归一化后的锚点
 * @param value 该锚点的实时值
 */
export function formatAnchorText(anchor: TwinAnchor, value: unknown): string {
  const reading = formatReading(finiteValue(value), anchor.decimals)
  return [anchor.label, reading, anchor.unit]
    .filter((part) => part !== '')
    .join(' ')
}
