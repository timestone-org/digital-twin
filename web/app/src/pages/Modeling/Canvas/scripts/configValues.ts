/** @fileoverview 参数表单的有效初值和由算子schema声明的就地边界校验。 */
import type { DtNumberRange } from '@dt/contracts'

import type { FormField } from './schemaForm'
import { missingHint } from './schemaForm'

export interface ConfigStatus {
  message: string
  hasDraft: boolean
}

export function fieldValue(
  field: FormField,
  config: Record<string, unknown>,
): unknown {
  return config[field.key] === undefined ? field.fallback : config[field.key]
}

function decimalPlaces(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  const [whole = '', exponent = '0'] = String(value).toLowerCase().split('e')
  return Math.max(0, (whole.split('.')[1]?.length ?? 0) - Number(exponent))
}

export function numberRange(
  field: FormField,
  value: unknown = field.fallback,
): DtNumberRange {
  const places = Math.min(
    12,
    Math.max(
      ...[value, field.fallback, field.min, field.max].map(decimalPlaces),
    ),
  )
  const step =
    field.widget === 'integer' ? 1 : (field.multipleOf ?? 10 ** -places)
  return {
    ...(field.min === null || field.isMinExclusive ? {} : { min: field.min }),
    ...(field.max === null || field.isMaxExclusive ? {} : { max: field.max }),
    step,
  }
}

function numericError(field: FormField, value: number): string {
  if (!Number.isFinite(value)) return '必须填写有限数值'
  if (field.widget === 'integer' && !Number.isInteger(value))
    return '必须填写整数'
  return numericLimitError(field, value)
}

function numericLimitError(field: FormField, value: number): string {
  if (
    field.min !== null &&
    (field.isMinExclusive ? value <= field.min : value < field.min)
  )
    return `必须${field.isMinExclusive ? '大于' : '不小于'} ${field.min}`
  if (
    field.max !== null &&
    (field.isMaxExclusive ? value >= field.max : value > field.max)
  )
    return `必须${field.isMaxExclusive ? '小于' : '不大于'} ${field.max}`
  return ''
}

export function arrayError(
  field: FormField,
  value: readonly unknown[],
): string {
  if (
    field.minItems !== null &&
    field.minItems !== undefined &&
    value.length < field.minItems
  )
    return `至少选择 ${field.minItems} 项`
  if (
    field.maxItems !== null &&
    field.maxItems !== undefined &&
    value.length > field.maxItems
  )
    return `最多选择 ${field.maxItems} 项`
  return ''
}

export function configError(field: FormField, value: unknown): string {
  if (Array.isArray(value)) return arrayError(field, value)
  const missing = missingHint(field, value)
  if (missing) return missing
  if (typeof value === 'number') return numericError(field, value)
  if (typeof value !== 'string') return ''
  return stringError(field, value)
}

function stringError(field: FormField, value: string): string {
  if (
    field.minLength !== null &&
    field.minLength !== undefined &&
    value.length < field.minLength
  )
    return `至少填写 ${field.minLength} 个字符`
  if (
    field.maxLength !== null &&
    field.maxLength !== undefined &&
    value.length > field.maxLength
  )
    return `最多填写 ${field.maxLength} 个字符`
  if (
    field.widget === 'select' &&
    !field.options.some((option) => option.value === value)
  )
    return '请选择有效选项'
  return ''
}
