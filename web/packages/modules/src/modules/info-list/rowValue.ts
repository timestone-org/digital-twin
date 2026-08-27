/**
 * @fileoverview info-list 一个读数格的四档与展示文本：没配来源／还没首帧／取不到／有值。
 *
 * ⚠ 四档在 `values` 里长得一模一样（键都不存在），全靠 `meta.slots` 分开——合成一档的
 * 代价是现场断了的那一格与从没配过的那一格在墙上是同一个「—」（DASHBOARD_DESIGN §4.3）。
 * ⚠ 前两档显示的是**同一个**占位符，只靠颜色与透明度分开：一行只有一格的宽度，
 * 摆不下「未绑定」「等待首帧」这样的短标签，完整原因挂 `title`。
 */
import type { ModuleSlotMeta } from '@dt/contracts'

import { fmtNumber, fmtTrim, isPresent, NO_DATA } from '../../shared/format'

/**
 * 一格此刻处在哪一档。
 * ⚠ `unbound` 与 `pending` 必须分开：前者要去配绑定，后者只要再等一会儿。
 */
export const CELL_STATES = ['ok', 'pending', 'error', 'unbound'] as const
export type CellState = (typeof CELL_STATES)[number]

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

/** 各档没有值时给看的人的一句话，鼠标停上去才看得全。 */
export const REASONS: Record<Exclude<CellState, 'ok'>, string> = {
  unbound: '这一格还没绑定数据来源',
  pending: '已绑定，还没收到第一帧',
  error: '取不到',
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
 * 这一格落在哪一档。
 * @param slot 这一槽的取数结论
 * @param raw 注入袋里这一格的原值
 * @param hasSlots 运行时下发了逐槽结论没有
 */
export function cellState(
  slot: ModuleSlotMeta | undefined,
  raw: unknown,
  hasSlots: boolean,
): CellState {
  if (slot !== undefined) return slot.state
  // ⚠ 没下发结论时只能退回「有没有值」这一条判据：设计态画布与独立挂载走这里。
  //   此时把没有值一律说成 unbound 是诚实的——那两处本来就没有取数
  if (!hasSlots) return raw === undefined ? 'unbound' : 'ok'
  return 'unbound'
}

/**
 * 没有值的那一句话；`error` 档带上取数侧给的原因。
 * @param state 这一格所在的档
 * @param slot 这一槽的取数结论
 */
export function reasonOf(
  state: CellState,
  slot: ModuleSlotMeta | undefined,
): string {
  if (state === 'ok') return ''
  const base = REASONS[state]
  const detail = slot?.message ?? ''
  return detail === '' ? base : `${base}：${detail}`
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
