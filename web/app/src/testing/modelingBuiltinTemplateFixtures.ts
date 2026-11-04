/** @fileoverview 内置模板接口测试数据：只提供元数据，不把图构造器混入响应。 */
import type { ModelingBuiltinTemplate, Page } from '@dt/contracts'
import { PIPELINE_TEMPLATES } from '@/pages/Modeling/Pipelines/scripts/templates'

export function builtinTemplatePage(
  keys: readonly string[] = PIPELINE_TEMPLATES.map((row) => row.key),
  category: ModelingBuiltinTemplate['category'] = 'prediction',
): Page<ModelingBuiltinTemplate> {
  const items = keys.map((key): ModelingBuiltinTemplate => {
    const template = PIPELINE_TEMPLATES.find((row) => row.key === key)
    if (!template) throw new Error(`缺少内置模板：${key}`)
    return {
      key: template.key,
      label: template.label,
      hint: template.hint,
      category,
    }
  })
  return { items, page: 1, size: 20, total: items.length }
}
