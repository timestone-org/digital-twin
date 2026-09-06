/** @fileoverview 编辑器 JSON 边界与模板初始值。 */
import type {
  ReportBody,
  ReportDocument,
  ReportTemplate,
  ReportTemplateUpdate,
} from '@dt/contracts'

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
export function documentFrom(value: unknown): ReportDocument {
  if (!isRecord(value) || typeof value['type'] !== 'string')
    throw new Error('文档结构无效')
  const node: ReportDocument = { type: value['type'] }
  if (typeof value['text'] === 'string') node.text = value['text']
  if (isRecord(value['attrs'])) node.attrs = value['attrs']
  if (Array.isArray(value['content']))
    node.content = value['content'].map((child: unknown) => documentFrom(child))
  if (Array.isArray(value['marks'])) node.marks = value['marks'].map(markFrom)
  return node
}
function markFrom(
  value: unknown,
): NonNullable<ReportDocument['marks']>[number] {
  const parsed = documentFrom(value)
  return { type: parsed.type, ...(parsed.attrs ? { attrs: parsed.attrs } : {}) }
}
export function blankReport(name = '新报告'): ReportBody {
  return {
    name,
    granularity: 'month',
    is_enabled: true,
    description: '',
    metrics: [],
    page_json: {},
    doc_json: { type: 'doc', content: [{ type: 'paragraph', content: [] }] },
  }
}
export function reportDraft(template: ReportTemplate): ReportBody {
  return {
    name: template.name,
    description: template.description,
    granularity: template.granularity,
    is_enabled: template.is_enabled,
    metrics: template.metrics,
    page_json: template.page_json,
    doc_json: template.doc_json,
  }
}
export function reportUpdate(
  body: ReportBody,
  version: number,
): ReportTemplateUpdate {
  return { ...body, expected_version: version }
}
export const GRANULARITIES = [
  { value: 'day', label: '日报' },
  { value: 'month', label: '月报' },
  { value: 'quarter', label: '季报' },
  { value: 'year', label: '年报' },
]
