/** @fileoverview 报告前端类型与真实 OpenAPI 的逐字段契约。 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ReportSchemas } from '@dt/contracts'

// OpenAPI 构建产物的结构边界，不是业务响应断言。
const spec = JSON.parse(
  readFileSync(
    join(
      process.cwd(),
      '..',
      'server',
      'services',
      'platform-server',
      'openapi.json',
    ),
    'utf8',
  ),
) as {
  components: {
    schemas: Record<string, { properties?: Record<string, unknown> }>
  }
}
const shapes = {
  ChartSeries: { name: true, points: true } satisfies Record<
    keyof ReportSchemas['ChartSeries'],
    true
  >,
  DocumentMark: { attrs: true, type: true } satisfies Record<
    keyof ReportSchemas['DocumentMark'],
    true
  >,
  DocumentNode: {
    attrs: true,
    content: true,
    marks: true,
    text: true,
    type: true,
  } satisfies Record<keyof ReportSchemas['DocumentNode'], true>,
  ImportResultOut: {
    doc_json: true,
    dropped: true,
    page_json: true,
  } satisfies Record<keyof ReportSchemas['ImportResultOut'], true>,
  ImportTicketOut: {
    fields: true,
    object_key: true,
    url: true,
  } satisfies Record<keyof ReportSchemas['ImportTicketOut'], true>,
  JsonValue: {} satisfies Record<keyof ReportSchemas['JsonValue'], true>,
  Margins: {
    bottom: true,
    left: true,
    right: true,
    top: true,
  } satisfies Record<keyof ReportSchemas['Margins'], true>,
  MetricDef: {
    agg: true,
    anchor: true,
    expr: true,
    key: true,
    mode: true,
    name: true,
    offset: true,
    table: true,
    unit: true,
    window: true,
  } satisfies Record<keyof ReportSchemas['MetricDef'], true>,
  MetricValue: {
    value_kind: true,
    error: true,
    is_truncated: true,
    is_stale: true,
    name: true,
    since: true,
    until: true,
    value: true,
  } satisfies Record<keyof ReportSchemas['MetricValue'], true>,
  NodeValue: {
    columns: true,
    is_truncated: true,
    is_stale: true,
    kind: true,
    rows: true,
    series: true,
    text: true,
    title: true,
  } satisfies Record<keyof ReportSchemas['NodeValue'], true>,
  PageSettings: {
    font_family: true,
    font_size_pt: true,
    footer: true,
    header: true,
    height_cm: true,
    margins_cm: true,
    orientation: true,
    is_toc_enabled: true,
    size: true,
    watermark: true,
    width_cm: true,
  } satisfies Record<keyof ReportSchemas['PageSettings'], true>,
  PreviewOut: {
    is_valid: true,
    metrics: true,
    nodes: true,
    period: true,
    timezone: true,
    warnings: true,
  } satisfies Record<keyof ReportSchemas['PreviewOut'], true>,
  RenderDetailOut: {
    created_at: true,
    error: true,
    finished_at: true,
    granularity: true,
    id: true,
    imported: true,
    kind: true,
    period: true,
    preview: true,
    schedule_id: true,
    started_at: true,
    status: true,
    template_id: true,
    timezone: true,
    warnings: true,
  } satisfies Record<keyof ReportSchemas['RenderDetailOut'], true>,
  RenderOut: {
    created_at: true,
    error: true,
    finished_at: true,
    granularity: true,
    id: true,
    kind: true,
    period: true,
    schedule_id: true,
    started_at: true,
    status: true,
    template_id: true,
    timezone: true,
    warnings: true,
  } satisfies Record<keyof ReportSchemas['RenderOut'], true>,
  ReportRuntimeOut: {
    is_schedule_enabled: true,
    timezone: true,
  } satisfies Record<keyof ReportSchemas['ReportRuntimeOut'], true>,
  ReportTemplateOut: {
    code: true,
    created_at: true,
    description: true,
    doc_json: true,
    granularity: true,
    id: true,
    is_enabled: true,
    metrics: true,
    name: true,
    page_json: true,
    row_version: true,
    updated_at: true,
  } satisfies Record<keyof ReportSchemas['ReportTemplateOut'], true>,
  ReportTemplateSummaryOut: {
    code: true,
    created_at: true,
    description: true,
    granularity: true,
    id: true,
    is_enabled: true,
    name: true,
    row_version: true,
    updated_at: true,
  } satisfies Record<keyof ReportSchemas['ReportTemplateSummaryOut'], true>,
  ScheduleOut: {
    created_at: true,
    delay_hours: true,
    granularity: true,
    id: true,
    is_enabled: true,
    last_run_period: true,
    name: true,
    row_version: true,
    template_id: true,
    updated_at: true,
  } satisfies Record<keyof ReportSchemas['ScheduleOut'], true>,
  SeriesPoint: { ts: true, value: true } satisfies Record<
    keyof ReportSchemas['SeriesPoint'],
    true
  >,
  TemplateIssue: {
    is_blocking: true,
    message: true,
    scope: true,
    where: true,
  } satisfies Record<keyof ReportSchemas['TemplateIssue'], true>,
  ValidationOut: { is_valid: true, issues: true } satisfies Record<
    keyof ReportSchemas['ValidationOut'],
    true
  >,
  Watermark: {
    font_size_pt: true,
    rotation: true,
    text: true,
  } satisfies Record<keyof ReportSchemas['Watermark'], true>,
}
describe('报告线形', () => {
  it.each(Object.entries(shapes))('%s 字段一致', (name, fields) => {
    expect(spec.components.schemas[name]).toBeDefined()
    expect(Object.keys(fields).sort()).toEqual(
      Object.keys(spec.components.schemas[name]?.properties ?? {}).sort(),
    )
  })
})
