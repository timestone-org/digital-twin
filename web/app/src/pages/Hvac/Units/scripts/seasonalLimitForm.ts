/** @fileoverview 两季达标范围的草稿、年度日期校验与提交载荷。 */
import type { AcCompliancePolicyInput } from '@dt/contracts'

import { toLimitPayload, validateRows } from './acLimitForm'
import type { LimitRow } from './acLimitForm'

export interface WinterDraft {
  isEnabled: boolean
  start: string
  end: string
  rows: LimitRow[]
}

export function emptyWinter(): WinterDraft {
  return { isEnabled: false, start: '', end: '', rows: [] }
}

export function validMonthDay(value: string): boolean {
  if (!/^\d{2}-\d{2}$/.test(value)) return false
  const month = Number(value.slice(0, 2))
  const day = Number(value.slice(3, 5))
  const date = new Date(Date.UTC(2000, month - 1, day))
  return date.getUTCMonth() + 1 === month && date.getUTCDate() === day
}

function complete(rows: readonly LimitRow[]): boolean {
  return ['workshop_temp_avg', 'workshop_humidity_avg'].every((metric) => {
    const row = rows.find((item) => item.metric === metric)
    return (
      row !== undefined && row.lower.trim() !== '' && row.upper.trim() !== ''
    )
  })
}

export function validateSeasonalLimits(
  rows: readonly LimitRow[],
  winter: WinterDraft,
): string | null {
  const invalid = validateRows(rows)
  if (invalid !== null || !winter.isEnabled) return invalid
  if (!validMonthDay(winter.start) || !validMonthDay(winter.end)) {
    return '请填写有效的冬季开始和结束日期，格式为 MM-DD'
  }
  if (!complete(rows) || !complete(winter.rows)) {
    return '配置冬季时间后，冬季和非冬季的温湿度上下限都必须填写'
  }
  return validateRows(winter.rows)
}

export function seasonalPayload(
  rows: readonly LimitRow[],
  winter: WinterDraft,
): AcCompliancePolicyInput {
  return {
    non_winter: toLimitPayload(rows),
    winter_period: winter.isEnabled
      ? { start: winter.start, end: winter.end }
      : null,
    winter: winter.isEnabled ? toLimitPayload(winter.rows) : [],
  }
}
