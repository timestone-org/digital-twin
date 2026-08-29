/**
 * @fileoverview info-list 一个读数格的展示文本。四档本身（没配来源／还没首帧／取不到／
 * 有值）的口径在 `shared/slotState.ts`，卡片族的部件读的是同一份。
 *
 * ⚠ 前两档显示的是**同一个**占位符，只靠颜色与透明度分开：一行只有一格的宽度，
 * 摆不下「未绑定」「等待首帧」这样的短标签，完整原因挂 `title`。
 */
import type { ModuleSlotMeta } from '@dt/contracts'

import { fmtNumber, fmtTrim, isPresent, NO_DATA } from '../../shared/format'
import { cellState, reasonOf, type CellState } from '../../shared/slotState'

export {
  CELL_STATES,
  REASONS,
  cellState,
  reasonOf,
  type CellState,
} from '../../shared/slotState'

/** 一个读数格要画的东西。 */
export interface ReadingView {
  state: CellState
  /** 展示文本；非 `ok` 档一律是占位符。 */
  text: string
  /** 单位；⚠ 非 `ok` 档一律空串——「— kV」看着像是有读数的。 */
  unit: string
  /** 这一格为什么没有值，一句完整的话，挂 `title`；`ok` 档是空串。 */
  reason: string
}

/** 一个读数格的输入：这一槽的结论、注入的原值，以及这一行的展示口径。 */
export interface ReadingInput {
  /** 这一槽的取数结论；缺席 = 没配来源，或运行时没下发结论。 */
  slot: ModuleSlotMeta | undefined
  raw: unknown
  /** 运行时下发了逐槽结论没有。 */
  hasSlots: boolean
  unit: string
  precision: number
  /** 数值要不要千分位。 */
  grouping: boolean
}

/**
 * 数值的展示文本。千分位那一档走 `fmtNumber`，关掉时走不分组的 `fmtTrim`。
 * @param raw 待格式化的原值
 * @param precision 最多几位小数
 * @param grouping 要不要千分位
 */
export function numberText(
  raw: unknown,
  precision: number,
  grouping: boolean,
): string {
  return grouping ? fmtNumber(raw, precision) : fmtTrim(raw, precision)
}

/**
 * 有值那一档的展示文本。
 * ⚠ 认不出的值照实显示原文，不静默换成占位符——「现场报的就是这么个东西」
 * 本身就是要看的信息。
 * @param raw 槽里的原值
 * @param precision 最多几位小数
 * @param grouping 要不要千分位
 */
function valueText(raw: unknown, precision: number, grouping: boolean): string {
  if (isPresent(raw)) return numberText(raw, precision, grouping)
  if (typeof raw === 'boolean') return raw ? 'true' : 'false'
  if (typeof raw === 'string' && raw.trim() !== '') return raw
  return NO_DATA
}

/** 没有读数的那三档共用的一格：同一个占位符，不给单位。 */
export function absentReading(
  state: Exclude<CellState, 'ok'>,
  slot?: ModuleSlotMeta,
): ReadingView {
  return { state, text: NO_DATA, unit: '', reason: reasonOf(state, slot) }
}

/**
 * 一格读数。
 * @param input 这一槽的结论、原值与展示口径
 */
export function readingOf(input: ReadingInput): ReadingView {
  const state = cellState(input.slot, input.raw, input.hasSlots)
  if (state !== 'ok') return absentReading(state, input.slot)
  return {
    state,
    text: valueText(input.raw, input.precision, input.grouping),
    unit: input.unit,
    reason: '',
  }
}
