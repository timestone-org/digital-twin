/**
 * @fileoverview 一个读数格此刻处在哪一档，以及没有值时给看的人的那句话。
 * 自报 `ownsStatusDisplay` 的模块都得自己把四档画出来，这份口径是它们共用的那一份。
 *
 * ⚠ 四档在注入袋里长得一模一样（键都不存在），全靠 `meta.slots` 分开——合成一档的
 * 代价是现场断了的那一格与从没配过的那一格在墙上是同一个「—」（DASHBOARD_DESIGN §4.3）。
 */
import type { ModuleSlotMeta } from '@dt/contracts'

/**
 * 一格此刻处在哪一档。
 * ⚠ `unbound` 与 `pending` 必须分开：前者要去配绑定，后者只要再等一会儿。
 */
export const CELL_STATES = ['ok', 'pending', 'error', 'unbound'] as const
export type CellState = (typeof CELL_STATES)[number]

/** 各档没有值时给看的人的一句话，鼠标停上去才看得全。 */
export const REASONS: Record<Exclude<CellState, 'ok'>, string> = {
  unbound: '这一格还没绑定数据来源',
  pending: '已绑定，还没收到第一帧',
  error: '取不到',
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
