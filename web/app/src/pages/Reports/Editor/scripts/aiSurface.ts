/** @fileoverview 报告模板编辑器的 AI 工作面与草稿工具。 */
import type {
  AssistantToolCall,
  ReportBody,
  ReportDocument,
  ReportMetric,
  ReportPage,
  ReportPreview,
  ReportSchemas,
} from '@dt/contracts'

import type { AiSurface, SurfaceSnapshot } from '@/features/ai/surfaces'

export const REPORT_TOOLS = [
  'report.read_draft',
  'report.set_template',
  'report.upsert_metric',
  'report.insert_content',
  'report.set_page',
  'report.validate_draft',
  'report.preview_draft',
] as const

const MAX_OUTLINE_NODES = 120
const MAX_NODE_TEXT = 240
const OUTLINE_ATTRS = [
  'level',
  'expr',
  'precision',
  'unit',
  'title',
  'table',
  'keys',
  'series',
  'window',
  'offset',
  'anchor',
  'kind',
  'limit',
] as const

interface OutlineState {
  items: SurfaceSnapshot[]
  isTruncated: boolean
}

export interface ReportSurfaceDeps {
  templateId: () => string
  draft: () => ReportBody
  setDraft: (draft: ReportBody) => void
  canEdit: () => boolean
  insert: (node: ReportDocument) => void
  validate: (draft: ReportBody) => Promise<ReportSchemas['ValidationOut']>
  preview: (period: string, draft: ReportBody) => Promise<ReportPreview>
  showPreview: (preview: ReportPreview) => void
}

/** 构造报告模板编辑器的助手工作面。 */
export function createReportSurface(deps: ReportSurfaceDeps): AiSurface {
  return {
    kind: 'report-editor',
    label: '报告模板编辑器',
    tools: REPORT_TOOLS,
    snapshot: () => snapshotOf(deps),
    run: (call) => runTool(deps, call),
  }
}

function snapshotOf(deps: ReportSurfaceDeps): SurfaceSnapshot {
  const draft = deps.draft()
  return {
    template_id: deps.templateId(),
    name: draft.name,
    granularity: draft.granularity ?? 'month',
    metric_count: draft.metrics?.length ?? 0,
    metrics: draft.metrics ?? [],
    page: draft.page_json ?? {},
    document: outlineOf(draft.doc_json),
  }
}

function outlineOf(document: ReportDocument | undefined): SurfaceSnapshot {
  const state: OutlineState = { items: [], isTruncated: false }
  if (document !== undefined) visitDocument(document, [], state)
  return {
    items: state.items,
    is_truncated: state.isTruncated,
  }
}

function visitDocument(
  node: ReportDocument,
  path: number[],
  state: OutlineState,
): void {
  if (state.items.length >= MAX_OUTLINE_NODES) {
    state.isTruncated = true
    return
  }
  if (node.type !== 'text') {
    const text = textOf(node).slice(0, MAX_NODE_TEXT)
    const attrs = compactAttrs(node.attrs)
    state.items.push({
      path: path.join('.'),
      type: node.type,
      ...(text ? { text } : {}),
      ...(Object.keys(attrs).length > 0 ? { attrs } : {}),
    })
  }
  node.content?.forEach((child, index) => {
    visitDocument(child, [...path, index], state)
  })
}

function compactAttrs(
  attrs: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (attrs === undefined) return {}
  const compact: Record<string, unknown> = {}
  for (const name of OUTLINE_ATTRS) {
    const value = attrs[name]
    if (typeof value === 'string') compact[name] = value.slice(0, MAX_NODE_TEXT)
    else if (typeof value === 'number' || typeof value === 'boolean')
      compact[name] = value
    else if (Array.isArray(value)) compact[name] = value.slice(0, 10)
  }
  return compact
}

function textOf(node: ReportDocument): string {
  if (node.text) return node.text
  return (node.content ?? []).map(textOf).join('')
}

async function runTool(
  deps: ReportSurfaceDeps,
  call: AssistantToolCall,
): Promise<unknown> {
  if (call.name === 'report.read_draft') return snapshotOf(deps)
  ensureEditable(deps)
  if (call.name === 'report.set_template') return setTemplate(deps, call)
  if (call.name === 'report.upsert_metric') return upsertMetric(deps, call)
  if (call.name === 'report.insert_content') return insertContent(deps, call)
  if (call.name === 'report.set_page') return setPage(deps, call)
  if (call.name === 'report.validate_draft') {
    return await deps.validate(deps.draft())
  }
  if (call.name === 'report.preview_draft') {
    const result = await deps.preview(
      requiredText(call, 'period'),
      deps.draft(),
    )
    deps.showPreview(result)
    return result
  }
  throw new Error(`当前页面没有实现 ${call.name}`)
}

function ensureEditable(deps: ReportSurfaceDeps): void {
  if (!deps.canEdit()) throw new Error('当前账号不能修改报告模板')
}

function setTemplate(
  deps: ReportSurfaceDeps,
  call: AssistantToolCall,
): SurfaceSnapshot {
  const current = deps.draft()
  const name = optionalText(call, 'name')
  if (name !== undefined && name.trim() === '')
    throw new Error('模板名称不能为空')
  const granularity = optionalGranularity(call.arguments['granularity'])
  const enabled = optionalBoolean(call, 'is_enabled')
  const description = optionalText(call, 'description')
  deps.setDraft({
    ...current,
    ...(name === undefined ? {} : { name }),
    ...(granularity === undefined ? {} : { granularity }),
    ...(enabled === undefined ? {} : { is_enabled: enabled }),
    ...(description === undefined ? {} : { description }),
  })
  return { ok: true, staged: true }
}

function upsertMetric(
  deps: ReportSurfaceDeps,
  call: AssistantToolCall,
): SurfaceSnapshot {
  const metric = metricOf(call)
  const current = deps.draft()
  const metrics = current.metrics ?? []
  const index = metrics.findIndex((item) => item.name === metric.name)
  const next = [...metrics]
  if (index < 0) next.push(metric)
  else next[index] = metric
  deps.setDraft({ ...current, metrics: next })
  return { ok: true, staged: true, replaced: index >= 0, name: metric.name }
}

function metricOf(call: AssistantToolCall): ReportMetric {
  const name = requiredText(call, 'name')
  const mode = metricMode(call.arguments['mode'])
  const metric: ReportMetric = {
    name,
    mode,
    offset: optionalInteger(call, 'offset') ?? 0,
    anchor: optionalAnchor(call.arguments['anchor']) ?? 'period',
  }
  assignOptionalText(metric, call, 'unit')
  assignOptionalText(metric, call, 'window')
  if (mode === 'expr') {
    metric.expr = requiredText(call, 'expr')
    return metric
  }
  metric.table = requiredText(call, 'table')
  metric.key = requiredText(call, 'key')
  const agg = optionalAgg(call.arguments['agg'])
  if (mode === 'window_agg' && agg === undefined)
    throw new Error('window_agg 指标少了参数 agg')
  if (mode === 'at_bucket' && !metric.window)
    throw new Error('at_bucket 指标少了参数 window')
  if (agg !== undefined) metric.agg = agg
  return metric
}

function assignOptionalText(
  metric: ReportMetric,
  call: AssistantToolCall,
  name: 'unit' | 'window',
): void {
  const value = optionalText(call, name)
  if (value !== undefined) metric[name] = value || null
}

function insertContent(
  deps: ReportSurfaceDeps,
  call: AssistantToolCall,
): SurfaceSnapshot {
  const kind = requiredText(call, 'kind')
  const node = contentNode(call, kind)
  deps.insert(node)
  return { ok: true, staged: true, type: node.type }
}

function contentNode(call: AssistantToolCall, kind: string): ReportDocument {
  if (kind === 'paragraph' || kind === 'heading') {
    const text = requiredText(call, 'text')
    const level = optionalInteger(call, 'level', 1, 6) ?? 2
    return {
      type: kind,
      ...(kind === 'heading' ? { attrs: { level } } : {}),
      content: [{ type: 'text', text }],
    }
  }
  if (kind === 'metric_ref' || kind === 'conditional_text') {
    return {
      type: kind === 'metric_ref' ? 'metricRef' : 'condText',
      attrs: {
        expr: requiredText(call, 'expression'),
        precision: optionalInteger(call, 'precision', 0, 10) ?? 2,
      },
    }
  }
  return dataNode(call, kind)
}

function dataNode(call: AssistantToolCall, kind: string): ReportDocument {
  if (!['line_chart', 'bar_chart', 'data_table'].includes(kind))
    throw new Error(`report.insert_content 不认识 kind=${kind}`)
  const table = requiredText(call, 'table')
  const key = requiredText(call, 'key')
  const title = optionalText(call, 'title') ?? ''
  return {
    type: kind === 'data_table' ? 'dsTable' : 'dsChart',
    attrs: {
      title,
      kind: kind === 'bar_chart' ? 'bar' : 'line',
      table,
      keys: [key],
      series: [{ table, key, name: optionalText(call, 'series_name') || key }],
      window: optionalText(call, 'window') || null,
      limit: optionalInteger(call, 'limit', 1, 1000) ?? 100,
    },
  }
}

function setPage(
  deps: ReportSurfaceDeps,
  call: AssistantToolCall,
): SurfaceSnapshot {
  const current = deps.draft()
  const page = pageOf(current.page_json ?? {}, call)
  deps.setDraft({ ...current, page_json: page })
  return { ok: true, staged: true, page }
}

function pageOf(current: ReportPage, call: AssistantToolCall): ReportPage {
  const page: ReportPage = { ...current }
  const size = optionalPageSize(call.arguments['size'])
  const orientation = optionalOrientation(call.arguments['orientation'])
  const family = optionalText(call, 'font_family')
  const fontSize = optionalNumber(call, 'font_size_pt', 1, 200)
  const header = optionalText(call, 'header')
  const footer = optionalText(call, 'footer')
  const toc = optionalBoolean(call, 'is_toc_enabled')
  if (size !== undefined) page.size = size
  if (orientation !== undefined) page.orientation = orientation
  if (family !== undefined) page.font_family = family
  if (fontSize !== undefined) page.font_size_pt = fontSize
  if (header !== undefined) page.header = header
  if (footer !== undefined) page.footer = footer
  if (toc !== undefined) page.is_toc_enabled = toc
  applyWatermark(page, call)
  applyMargins(page, call)
  return page
}

function applyWatermark(page: ReportPage, call: AssistantToolCall): void {
  const text = optionalText(call, 'watermark_text')
  if (text === undefined) return
  page.watermark = text ? { ...(page.watermark ?? {}), text } : null
}

function applyMargins(page: ReportPage, call: AssistantToolCall): void {
  const top = optionalNumber(call, 'margin_top_cm', 0, 20)
  const bottom = optionalNumber(call, 'margin_bottom_cm', 0, 20)
  const left = optionalNumber(call, 'margin_left_cm', 0, 20)
  const right = optionalNumber(call, 'margin_right_cm', 0, 20)
  if ([top, bottom, left, right].every((value) => value === undefined)) return
  page.margins_cm = {
    ...(page.margins_cm ?? {}),
    ...(top === undefined ? {} : { top }),
    ...(bottom === undefined ? {} : { bottom }),
    ...(left === undefined ? {} : { left }),
    ...(right === undefined ? {} : { right }),
  }
}

function requiredText(call: AssistantToolCall, name: string): string {
  const value = optionalText(call, name)
  if (value === undefined || value.trim() === '')
    throw new Error(`${call.name} 少了参数 ${name}`)
  return value
}

function optionalText(
  call: AssistantToolCall,
  name: string,
): string | undefined {
  const value = call.arguments[name]
  if (value === undefined) return undefined
  if (typeof value !== 'string')
    throw new Error(`${call.name} 的 ${name} 必须是文本`)
  return value
}

function optionalBoolean(
  call: AssistantToolCall,
  name: string,
): boolean | undefined {
  const value = call.arguments[name]
  if (value === undefined) return undefined
  if (typeof value !== 'boolean')
    throw new Error(`${call.name} 的 ${name} 必须是真假值`)
  return value
}

function optionalNumber(
  call: AssistantToolCall,
  name: string,
  min: number,
  max: number,
): number | undefined {
  const value = call.arguments[name]
  if (value === undefined) return undefined
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  )
    throw new Error(`${call.name} 的 ${name} 必须在 ${min}–${max} 之间`)
  return value
}

function optionalInteger(
  call: AssistantToolCall,
  name: string,
  min = -120,
  max = 120,
): number | undefined {
  const value = optionalNumber(call, name, min, max)
  if (value !== undefined && !Number.isInteger(value))
    throw new Error(`${call.name} 的 ${name} 必须是整数`)
  return value
}

function metricMode(value: unknown): NonNullable<ReportMetric['mode']> {
  if (
    value === 'latest' ||
    value === 'at_bucket' ||
    value === 'window_agg' ||
    value === 'expr'
  )
    return value
  throw new Error('report.upsert_metric 的 mode 无效')
}

function optionalAgg(value: unknown): ReportMetric['agg'] {
  if (value === undefined) return undefined
  if (
    value === 'avg' ||
    value === 'min' ||
    value === 'max' ||
    value === 'last' ||
    value === 'first' ||
    value === 'sum' ||
    value === 'count' ||
    value === 'delta'
  )
    return value
  throw new Error('report.upsert_metric 的 agg 无效')
}

function optionalAnchor(value: unknown): ReportMetric['anchor'] {
  if (value === undefined || value === 'period' || value === 'latest')
    return value
  throw new Error('report.upsert_metric 的 anchor 无效')
}

function optionalGranularity(value: unknown): ReportBody['granularity'] {
  if (
    value === undefined ||
    value === 'day' ||
    value === 'month' ||
    value === 'quarter' ||
    value === 'year'
  )
    return value
  throw new Error('report.set_template 的 granularity 无效')
}

function optionalPageSize(value: unknown): ReportPage['size'] {
  if (
    value === undefined ||
    value === 'A4' ||
    value === 'A3' ||
    value === 'Letter' ||
    value === 'Legal'
  )
    return value
  throw new Error('report.set_page 的 size 无效')
}

function optionalOrientation(value: unknown): ReportPage['orientation'] {
  if (value === undefined || value === 'portrait' || value === 'landscape')
    return value
  throw new Error('report.set_page 的 orientation 无效')
}
