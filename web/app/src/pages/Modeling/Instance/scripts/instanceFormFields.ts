/** @fileoverview 实例参数复用共享字段；未知列候选保留手填能力。 */
import type { ModelingParameterNode } from '@dt/contracts'
import type {
  FormField,
  FormOptions,
} from '@/features/modeling-config/scripts/schemaForm'
import { fieldsOf } from '@/features/modeling-config/scripts/schemaForm'

export function instanceFields(
  node: ModelingParameterNode,
): readonly FormField[] {
  return fieldsOf(node.operator.config_schema).map((field) => {
    if (field.widget === 'table')
      return {
        ...field,
        widget: 'text',
        hint: `${field.hint}；填写目标环境的台账编码`,
      }
    if (
      node.known_columns === null &&
      ['column', 'columns'].includes(field.widget)
    )
      return {
        ...field,
        widget: field.widget === 'columns' ? 'text-list' : 'text',
        hint: `${field.hint}；当前没有列候选，可直接填写列编码`,
      }
    if (field.jsonType === 'object' && field.widget === 'text')
      return { ...field, widget: 'json' }
    return field
  })
}
export function instanceOptions(node: ModelingParameterNode): FormOptions {
  return {
    tables: [],
    tablesState: 'ready',
    tablesNote: '',
    columns: (node.known_columns ?? []).map((key) => ({ key, name: key })),
    columnsNote: '修改上游取数配置后，请保存并重新加载以更新列候选。',
  }
}
