/** @fileoverview 表格算子说明的公式行与冻结参数呈现。 */
import { nameOf, opOf, run, varOf } from './formula'
import type { FormulaNode } from './formula'
import type { FormulaContext, FormulaLegend, FormulaSpec } from './formulaArgs'
import { NO_CONFIG } from './formulaArgs'
import { niceNumber } from './numbers'
import {
  fieldsOf,
  visibleFields,
} from '@/features/modeling-config/scripts/schemaForm'

interface Explanation {
  id: string
  title: string
  expressions: readonly string[]
  parameters: readonly (readonly [string, string])[]
  notes: string[]
  legend?: FormulaLegend[]
}
function lineOf(expression: string): FormulaNode {
  return run(
    ...expression
      .split(/\s([=+−])\s/)
      .map((part) =>
        ['=', '+', '−'].includes(part) ? opOf(part) : varOf(part),
      ),
  )
}
function parameterText(value: unknown): string | null {
  if (typeof value === 'number')
    return Number.isFinite(value) ? niceNumber(value) : null
  if (typeof value === 'boolean') return value ? '是' : '否'
  if (typeof value === 'string')
    return value.length > 48 ? `${value.slice(0, 48)}…` : JSON.stringify(value)
  if (!Array.isArray(value)) return null
  const texts = value
    .slice(0, 3)
    .map(parameterText)
    .filter((text) => text !== null)
  return `[${texts.join('、')}${value.length > 3 ? `，另 ${value.length - 3} 项` : ''}]`
}
export function tableExplanation(
  context: FormulaContext,
  description: Explanation,
): FormulaSpec {
  const visible = context.schema
    ? new Set(
        visibleFields(fieldsOf(context.schema), context.config).map(
          (field) => field.key,
        ),
      )
    : null
  const filled = description.parameters.flatMap(([key, label]) => {
    if (visible && !visible.has(key)) return []
    const text = parameterText(context.config[key])
    return text === null ? [] : [run(nameOf(label), opOf('='), nameOf(text))]
  })
  return {
    id: description.id,
    title: description.title,
    symbolic: description.expressions.map(lineOf),
    filled: filled.length > 0 ? filled : null,
    fallback: filled.length > 0 ? null : NO_CONFIG,
    isOpen: false,
    legend: description.legend ?? [],
    notes: description.notes,
  }
}
