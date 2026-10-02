/** @fileoverview 定时规则名称与延迟的表单校验，边界与 ScheduleBody 一致。 */
import type { ReportScheduleUpdate } from '@dt/contracts'

export interface ScheduleErrors {
  name: string
  delayHours: string
}
type ScheduleFields = Required<
  Pick<ReportScheduleUpdate, 'name' | 'delay_hours'>
>

/** 字段校验提示的空状态。 */
export function emptyScheduleErrors(): ScheduleErrors {
  return { name: '', delayHours: '' }
}

/** 校验填写值，并将合法延迟转换为整数小时。 */
export function validateScheduleFields(
  name: string,
  delay: string,
): { fields: ScheduleFields | null; errors: ScheduleErrors } {
  const trimmedName = name.trim()
  const hours = delay.trim()
  const delayHours = Number(hours)
  const errors = emptyScheduleErrors()
  if (!trimmedName) errors.name = '规则名称不能为空'
  else if (Array.from(trimmedName).length > 128)
    errors.name = '规则名称最多 128 个字符'
  if (!/^\d+$/.test(hours) || !Number.isFinite(delayHours) || delayHours > 720)
    errors.delayHours = '请输入 0～720 的整数小时数'
  return {
    fields:
      errors.name || errors.delayHours
        ? null
        : { name: trimmedName, delay_hours: delayHours },
    errors,
  }
}
