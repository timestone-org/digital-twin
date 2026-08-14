/**
 * @fileoverview 把绑定值缝合回配置的纯数学：数组行按文档序对齐成 id 映射、
 * 染色取色与告警判定、锚点读数格式化。无 Vue、无 three、无 DOM。
 */
import type { TwinRowSlot } from './constants'
import {
  clamp01,
  finiteValue,
  isRecord,
  lerpHexColor,
  toArray,
  toFiniteNumber,
} from './sanitize'
import type {
  TwinAnchor,
  TwinAnchorValue,
  TwinAnchorValues,
  TwinPart,
  TwinTintRule,
  TwinTintValue,
  TwinTintValues,
} from './types'

/**
 * 无值时的稳定空引用。
 * ⚠ 每帧新建一个空对象，会让下游 watch 每帧都触发一次——大屏其它槽有新值时，
 * 一个一个绑定都没配的孪生模块也会跟着空转重算。
 */
export const EMPTY_TINT_VALUES: TwinTintValues = Object.freeze({})
export const EMPTY_ANCHOR_VALUES: TwinAnchorValues = Object.freeze({})

/** 第 index 行的 sub 子槽；行不是对象一律按无值处理。 */
function readRowSlot(rows: unknown, index: number, sub: TwinRowSlot): unknown {
  const row = toArray(rows)[index]
  return isRecord(row) ? finiteValue(row[sub]) : undefined
}

/**
 * 染色数组行 → 规则 id 映射，第 i 行对应文档序第 i 条规则。
 * ⚠ `tints` 必须是 `normalizeTwinConfig` 的输出：派生绑定行与这里读值用同一个下标，
 * 喂原始配置会因为脏条目被丢弃而整体错位一格。
 * @param tints 归一化后的染色规则
 * @param rows 模块 values 里 `tintValues` 槽的整个数组
 */
export function stitchTintValues(
  tints: readonly TwinTintRule[] | undefined,
  rows: unknown,
): TwinTintValues {
  const out: Record<string, TwinTintValue> = {}
  ;(tints ?? []).forEach((rule, index) => {
    const value = readRowSlot(rows, index, 'value')
    const status = readRowSlot(rows, index, 'status')
    if (value === undefined && status === undefined) return
    out[rule.id] = { value, status }
  })
  return Object.keys(out).length === 0 ? EMPTY_TINT_VALUES : out
}

/**
 * 锚点数组行 → 锚点 id 映射，第 i 行对应文档序第 i 个锚点。
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

/** 状态值的展示文本；对象与空值一律空串，不做 `[object Object]` 这种上屏。 */
function statusText(status: unknown): string {
  if (typeof status === 'string') return status.trim()
  if (typeof status === 'number' || typeof status === 'boolean') {
    return String(status)
  }
  return ''
}

function gradientColor(
  rule: TwinTintRule,
  value: TwinTintValue | undefined,
): string | null {
  const gradient = rule.gradient
  if (gradient === null) return null
  const reading = toFiniteNumber(value?.value)
  if (reading === null) return null
  const span = gradient.max - gradient.min
  const ratio = span === 0 ? 0 : clamp01((reading - gradient.min) / span)
  return lerpHexColor(gradient.lo, gradient.hi, ratio)
}

/**
 * 规则当前该染的颜色规格（`#rrggbb` 或 `--token`）；null = 不染色。
 * @param rule 归一化后的染色规则
 * @param value 该规则缝合出来的实时值
 */
export function tintColorSpec(
  rule: TwinTintRule,
  value: TwinTintValue | undefined,
): string | null {
  if (rule.mode === 'gradient') return gradientColor(rule, value)
  const status = statusText(value?.status)
  if (status === '') return null
  return (
    rule.statusColors[status] ?? rule.statusColors[status.toLowerCase()] ?? null
  )
}

/** 该规则当前是否处于告警态，状态比对大小写不敏感。 */
export function isTintAlarm(
  rule: TwinTintRule,
  value: TwinTintValue | undefined,
): boolean {
  const status = statusText(value?.status).toLowerCase()
  if (status === '') return false
  return rule.alarmStatus.some((alarm) => alarm.toLowerCase() === status)
}

/**
 * 规则命中的模型节点名，按 `partIds` 展开去重。
 * 引用不到的部件不产出节点——悬空引用由 `collectTwinConfigIssues` 报，这里不猜。
 * @param parts 归一化后的部件
 * @param rule 归一化后的染色规则
 */
export function tintTargetNodes(
  parts: readonly TwinPart[] | undefined,
  rule: TwinTintRule,
): string[] {
  const byId = new Map((parts ?? []).map((part) => [part.id, part]))
  const out = new Set<string>()
  for (const partId of rule.partIds) {
    for (const node of byId.get(partId)?.nodes ?? []) out.add(node)
  }
  return [...out]
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
