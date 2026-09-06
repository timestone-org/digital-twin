/** @fileoverview 从 platform OpenAPI 生成的报告契约。 */
export interface ReportSchemas {
  ChartSeries: { name: string; points: ReportSchemas['SeriesPoint'][] }
  DocumentMark: {
    attrs?: Record<string, ReportSchemas['JsonValue']>
    type: string
  }
  DocumentNode: {
    attrs?: Record<string, ReportSchemas['JsonValue']>
    content?: ReportSchemas['DocumentNode'][]
    marks?: ReportSchemas['DocumentMark'][]
    text?: string | null
    type: string
  }
  ImportResultOut: {
    doc_json: ReportSchemas['DocumentNode']
    dropped: string[]
    page_json: ReportSchemas['PageSettings']
  }
  ImportStartIn: { object_key: string }
  ImportTicketIn: { size_bytes: number }
  ImportTicketOut: {
    fields: Record<string, string>
    object_key: string
    url: string
  }
  JsonValue: unknown
  Margins: { bottom?: number; left?: number; right?: number; top?: number }
  MetricDef: {
    agg?: 'avg' | 'min' | 'max' | 'last' | 'first' | 'sum' | 'count' | 'delta'
    anchor?: 'period' | 'latest'
    expr?: string | null
    key?: string | null
    mode?: 'latest' | 'at_bucket' | 'window_agg' | 'expr'
    name: string
    offset?: number
    table?: string | null
    unit?: string | null
    window?: string | null
  }
  MetricValue: {
    error?: string | null
    is_stale?: boolean
    is_truncated?: boolean
    name: string
    since?: string | null
    until?: string | null
    value: string | boolean | null
    value_kind?: 'number' | 'text' | 'boolean' | 'empty'
  }
  NodeValue: {
    columns?: string[]
    is_stale?: boolean
    is_truncated?: boolean
    kind: string
    rows?: string[][]
    series?: ReportSchemas['ChartSeries'][]
    text?: string
    title?: string
  }
  PageSettings: {
    font_family?: string
    font_size_pt?: number
    footer?: string
    header?: string
    height_cm?: number
    is_toc_enabled?: boolean
    margins_cm?: ReportSchemas['Margins']
    orientation?: 'portrait' | 'landscape'
    size?: 'A4' | 'A3' | 'Letter' | 'Legal' | 'custom'
    watermark?: ReportSchemas['Watermark'] | null
    width_cm?: number
  }
  PreviewIn: {
    draft?: ReportSchemas['TemplateBody'] | null
    granularity?: 'day' | 'month' | 'quarter' | 'year' | null
    period: string
  }
  PreviewOut: {
    is_valid: boolean
    metrics: ReportSchemas['MetricValue'][]
    nodes: Record<string, ReportSchemas['NodeValue']>
    period: string
    timezone: string
    warnings: string[]
  }
  RenderCreateIn: {
    granularity?: 'day' | 'month' | 'quarter' | 'year' | null
    period: string
    template_id: string
  }
  RenderDetailOut: {
    created_at: string
    error: string | null
    finished_at: string | null
    granularity: 'day' | 'month' | 'quarter' | 'year'
    id: string
    imported?: ReportSchemas['ImportResultOut'] | null
    kind: 'render' | 'import'
    period: string
    preview?: ReportSchemas['PreviewOut'] | null
    schedule_id: string | null
    started_at: string | null
    status: 'pending' | 'running' | 'succeeded' | 'failed'
    template_id: string | null
    timezone: string
    warnings: string[]
  }
  RenderOut: {
    created_at: string
    error: string | null
    finished_at: string | null
    granularity: 'day' | 'month' | 'quarter' | 'year'
    id: string
    kind: 'render' | 'import'
    period: string
    schedule_id: string | null
    started_at: string | null
    status: 'pending' | 'running' | 'succeeded' | 'failed'
    template_id: string | null
    timezone: string
    warnings: string[]
  }
  ReportRuntimeOut: { is_schedule_enabled: boolean; timezone: string }
  ReportTemplateCreateIn: {
    code: string
    description?: string | null
    doc_json?: ReportSchemas['DocumentNode']
    granularity?: 'day' | 'month' | 'quarter' | 'year'
    is_enabled?: boolean
    metrics?: ReportSchemas['MetricDef'][]
    name: string
    page_json?: ReportSchemas['PageSettings']
  }
  ReportTemplateOut: {
    code: string
    created_at: string
    description: string | null
    doc_json: ReportSchemas['DocumentNode']
    granularity: 'day' | 'month' | 'quarter' | 'year'
    id: string
    is_enabled: boolean
    metrics: ReportSchemas['MetricDef'][]
    name: string
    page_json: ReportSchemas['PageSettings']
    row_version: number
    updated_at: string
  }
  ReportTemplateSummaryOut: {
    code: string
    created_at: string
    description: string | null
    granularity: 'day' | 'month' | 'quarter' | 'year'
    id: string
    is_enabled: boolean
    name: string
    row_version: number
    updated_at: string
  }
  ScheduleCreateIn: {
    delay_hours?: number
    granularity?: 'day' | 'month' | 'quarter' | 'year'
    is_enabled?: boolean
    name: string
    template_id: string
  }
  ScheduleOut: {
    created_at: string
    delay_hours: number
    granularity: 'day' | 'month' | 'quarter' | 'year'
    id: string
    is_enabled: boolean
    last_run_period: string | null
    name: string
    row_version: number
    template_id: string
    updated_at: string
  }
  ScheduleUpdateIn: {
    delay_hours?: number
    expected_version: number
    granularity?: 'day' | 'month' | 'quarter' | 'year'
    is_enabled?: boolean
    name: string
  }
  SeriesPoint: { ts: string; value: string | null }
  TemplateBody: {
    description?: string | null
    doc_json?: ReportSchemas['DocumentNode']
    granularity?: 'day' | 'month' | 'quarter' | 'year'
    is_enabled?: boolean
    metrics?: ReportSchemas['MetricDef'][]
    name: string
    page_json?: ReportSchemas['PageSettings']
  }
  TemplateIssue: {
    is_blocking?: boolean
    message: string
    scope: string
    where: string
  }
  TemplateUpdateIn: {
    description?: string | null
    doc_json?: ReportSchemas['DocumentNode']
    expected_version: number
    granularity?: 'day' | 'month' | 'quarter' | 'year'
    is_enabled?: boolean
    metrics?: ReportSchemas['MetricDef'][]
    name: string
    page_json?: ReportSchemas['PageSettings']
  }
  ValidationOut: { is_valid: boolean; issues: ReportSchemas['TemplateIssue'][] }
  Watermark: { font_size_pt?: number; rotation?: number; text?: string }
}
export type ReportTemplate = ReportSchemas['ReportTemplateOut']
export type ReportTemplateSummary = ReportSchemas['ReportTemplateSummaryOut']
export type ReportTemplateCreate = ReportSchemas['ReportTemplateCreateIn']
export type ReportTemplateUpdate = ReportSchemas['TemplateUpdateIn']
export type ReportBody = ReportSchemas['TemplateBody']
export type ReportDocument = ReportSchemas['DocumentNode']
export type ReportMetric = ReportSchemas['MetricDef']
export type ReportPage = ReportSchemas['PageSettings']
export type ReportPreview = ReportSchemas['PreviewOut']
export type ReportRender = ReportSchemas['RenderOut']
export type ReportRenderDetail = ReportSchemas['RenderDetailOut']
export type ReportSchedule = ReportSchemas['ScheduleOut']
export type ReportScheduleCreate = ReportSchemas['ScheduleCreateIn']
export type ReportScheduleUpdate = ReportSchemas['ScheduleUpdateIn']
