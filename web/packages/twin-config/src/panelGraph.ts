/**
 * @fileoverview 信息牌图形字段的取数语义：哪些画法吃量程、读数落在量程的几成、
 * 读数命中哪一档色。渲染层、编辑器与配置体检三处共用这一份口径。
 *
 * ⚠ 三处各算各的时，界面上一切正常——只是编辑器里核对过的阈值到了大屏上换了
 * 一档颜色，而没有任何一处报错。
 */
import { toFiniteNumber } from './sanitize'
import { TWIN_PANEL_FIELD_KINDS } from './types'
import type {
  TwinPanelField,
  TwinPanelFieldKind,
  TwinPanelLevel,
  TwinPanelTone,
} from './types'

/** 吃量程的那几种画法：没有量程它们画不出「占几成」。 */
const KINDS_WITH_RANGE: readonly TwinPanelFieldKind[] = [
  'bar',
  'gauge',
  'sparkline',
  'bars',
]

/** 会攒历史序列的那两种画法。 */
const KINDS_WITH_SERIES: readonly TwinPanelFieldKind[] = ['sparkline', 'bars']

/**
 * 这种画法要不要量程。
 * @param kind 字段画法
 */
export function panelKindUsesRange(kind: TwinPanelFieldKind): boolean {
  return KINDS_WITH_RANGE.includes(kind)
}

/**
 * 这种画法要不要攒历史序列。
 * @param kind 字段画法
 */
export function panelKindUsesSeries(kind: TwinPanelFieldKind): boolean {
  return KINDS_WITH_SERIES.includes(kind)
}

/** 全部画法，供编辑器列选项；顺序即菜单序。 */
export const PANEL_FIELD_KINDS = TWIN_PANEL_FIELD_KINDS

/**
 * 量程跨度；上限不大于下限时给 null——那样的量程画出来的图形是骗人的。
 * @param field 归一化后的字段
 */
export function panelFieldSpan(field: TwinPanelField): number | null {
  const span = field.max - field.min
  return span > 0 ? span : null
}

/**
 * 读数落在量程里的位置，0–1。
 * ⚠ 夹进 [0,1] 而不是任其越界：超量程的读数会把进度条画到卡片外面去，
 * 而那看起来像是版式坏了，不像是「这个量超了」。
 * @param field 归一化后的字段
 * @param value 实时值；取不到有限数时给 null
 */
export function panelFieldRatio(
  field: TwinPanelField,
  value: unknown,
): number | null {
  const span = panelFieldSpan(field)
  const reading = toFiniteNumber(value)
  if (span === null || reading === null) return null
  return Math.min(1, Math.max(0, (reading - field.min) / span))
}

/**
 * 读数命中的色档；没配阈值或读数取不到时给 null（= 用牌的主题色）。
 * ⚠ 取的是**满足条件里 `at` 最大的那一档**，与档在数组里的先后无关：
 * 取第一个满足的会让「危险档写在预警档前面」的配置永远显示预警色，
 * 而两行数字并排摆着看不出问题。
 * @param field 归一化后的字段
 * @param value 实时值
 */
export function panelFieldTone(
  field: TwinPanelField,
  value: unknown,
): TwinPanelTone | null {
  const reading = toFiniteNumber(value)
  if (reading === null) return null
  let hit: TwinPanelLevel | null = null
  for (const level of field.levels) {
    if (reading >= level.at && (hit === null || level.at > hit.at)) hit = level
  }
  return hit?.tone ?? null
}
