/** @fileoverview 算子列表参数的可读文本与数值形状校验。 */
import type { FormField } from './schemaForm'
import { arrayError } from './configValues'

export interface ParsedArray {
  value: (string | number)[] | null
  error: string
}

export function parseArrayConfig(raw: string, field: FormField): ParsedArray {
  const texts =
    raw.trim() === '' ? [] : raw.split(/[,，\n]/).map((item) => item.trim())
  const limit = arrayError(field, texts)
  if (limit) return { value: null, error: limit }
  if (texts.some((item) => item === ''))
    return { value: null, error: '每项都必须填写完整' }
  if (field.widget === 'text-list') return { value: texts, error: '' }
  return numericItems(texts, field)
}

function numericItems(texts: readonly string[], field: FormField): ParsedArray {
  const values = texts.map(Number)
  if (values.some((item) => !Number.isFinite(item)))
    return { value: null, error: '每项必须是有限数值' }
  if (
    field.widget === 'integer-list' &&
    values.some((item) => !Number.isInteger(item))
  )
    return { value: null, error: '每项必须是整数' }
  const error = itemBounds(values, field)
  return error ? { value: null, error } : { value: values, error: '' }
}

function itemBounds(values: readonly number[], field: FormField): string {
  const minimum = field.itemMin
  const maximum = field.itemMax
  if (
    minimum !== null &&
    minimum !== undefined &&
    values.some((item) => item < minimum)
  )
    return `每项必须不小于 ${minimum}`
  if (
    maximum !== null &&
    maximum !== undefined &&
    values.some((item) => item > maximum)
  )
    return `每项必须不大于 ${maximum}`
  if (field.hasUniqueItems && new Set(values).size !== values.length)
    return '列表中不能有重复项'
  return ''
}
