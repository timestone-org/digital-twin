/** @fileoverview 风向角归一化与逐槽读数，见 docs/MODULE_WIND_COMPASS_DESIGN.md。 */
import type { ModuleSlotMeta } from '@dt/contracts'

import { fmtNumber } from '../../shared/format'
import { cellState, reasonOf } from '../../shared/slotState'

const DIRECTIONS = ['北', '东北', '东', '东南', '南', '西南', '西', '西北']

/** 归一到顺时针、正北为零的角度；无效值保持缺失。 */
export function normalizeDirection(raw: unknown): number | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null
  return ((raw % 360) + 360) % 360
}

/** 取最接近的八方位名称。 */
export function directionLabel(angle: number | null): string {
  return angle === null ? '—' : (DIRECTIONS[Math.round(angle / 45) % 8] ?? '—')
}

/** 收敛一个读数的状态、文案与有限数值。 */
export function windReading(
  raw: unknown,
  slot: ModuleSlotMeta | undefined,
  hasSlots: boolean,
  precision: number,
) {
  const state = cellState(slot, raw, hasSlots)
  const value =
    state === 'ok' && typeof raw === 'number' && Number.isFinite(raw)
      ? raw
      : null
  const text =
    state === 'pending'
      ? '等待数据'
      : state === 'error'
        ? '取不到'
        : fmtNumber(value, precision)
  return {
    value,
    text,
    reason: reasonOf(state, slot),
    isStale: slot?.isStale === true,
  }
}
