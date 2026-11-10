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
/**
 * 正文的规范形：键排序、去掉空值与空的 marks。服务端存的形状与 Umo 吐出来的
 * 形状键序不同、空值写法不同，语义却一样；比较「改没改」只能比这个。
 * @param value 一份正文或其中一个节点
 */
export function canonicalDocument(value: unknown): string {
  return JSON.stringify(canonicalValue(value))
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue)
  if (!isRecord(value)) return value
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(value).sort()) {
    const item = value[key]
    if (item === null || item === undefined) continue
    if (key === 'marks' && Array.isArray(item) && item.length === 0) continue
    out[key] = canonicalValue(item)
  }
  return out
}
export function blankReport(name = '新报告'): ReportBody {
  return {
    name,
    granularity: 'month',
    is_enabled: true,
    description: '',
    metrics: [],
    api_sources: [],
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
    api_sources: template.api_sources ?? [],
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

/**
 * 周期代码的中文名；认不出的原样显示。
 * @param value 周期代码，如 month
 */
export function granularityLabel(value: string): string {
  return GRANULARITIES.find((item) => item.value === value)?.label ?? value
}
