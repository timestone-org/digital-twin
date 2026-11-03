/** @fileoverview 根据算子 Schema 的算法选项提供检索与冻结结果名称。 */
import type { ModelingOperator } from '@dt/contracts'
import { fieldsOf } from '@/features/modeling-config/scripts/schemaForm'

const BRAND_SEARCH_ALIASES: Readonly<Record<string, string>> = {
  xgboost: 'xgb xgboost',
  lightgbm: 'lgb lgbm lightgbm',
  catboost: 'catboost',
}

export function algorithmOptions(operator: ModelingOperator) {
  return (
    fieldsOf(operator.config_schema).find((field) => field.key === 'algorithm')
      ?.options ?? []
  )
}
export function operatorSearchText(operator: ModelingOperator): string {
  return [
    operator.name,
    operator.code,
    operator.description,
    ...algorithmOptions(operator).flatMap((option) => [
      option.value,
      option.value.replaceAll('_', ' '),
      option.value.replaceAll('_', ''),
      option.label,
      BRAND_SEARCH_ALIASES[option.value] ?? '',
    ]),
  ]
    .join(' ')
    .toLowerCase()
}
export function modelAlgorithmName(
  operator: ModelingOperator | undefined,
  config: Readonly<Record<string, unknown>>,
  raw: string,
): string {
  if (!operator) return raw
  const fields = fieldsOf(operator.config_schema)
  const selector = fields.find(
    (field) => field.key === 'algorithm' || field.key === 'shape',
  )
  const selected = selector ? config[selector.key] : undefined
  const label = selector?.options.find(
    (option) => option.value === selected || option.value === raw,
  )?.label
  if (label) return label
  if (typeof selected === 'string' && selected !== '' && raw === operator.code)
    return selected
  return operator.code === raw ? operator.name : raw
}
