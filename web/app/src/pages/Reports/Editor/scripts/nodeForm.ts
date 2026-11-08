/**
 * @fileoverview 数据内容弹窗的表单状态与节点属性互转，字段口径同后端 `DataNodeSpec`。
 */
import type { ReportDocument } from '@dt/contracts'

export type NodeKind =
  'condText' | 'metricRef' | 'line' | 'bar' | 'pie' | 'dsTable'
export type XAxis = 'time' | 'category' | 'field'

export interface SeriesRow {
  id: string
  table: string
  key: string
  name: string
  offset: number
}

export interface NodeForm {
  kind: NodeKind
  expression: string
  precision: string
  unit: string
  title: string
  source: string
  keys: string[]
  series: SeriesRow[]
  xAxis: XAxis
  categoryKey: string
  bucket: string
  agg: string
  order: string
  timeFormat: string
  summary: string
  window: string
  offset: number
  limit: string
}

export const NODE_KINDS: { value: NodeKind; label: string }[] = [
  { value: 'line', label: '折线图' },
  { value: 'bar', label: '柱状图' },
  { value: 'pie', label: '饼图' },
  { value: 'dsTable', label: '数据表格' },
  { value: 'metricRef', label: '指标数字' },
  { value: 'condText', label: '条件文本' },
]
export const X_AXES: { value: XAxis; label: string }[] = [
  { value: 'time', label: '按时间（趋势）' },
  { value: 'category', label: '按分类字段（如车间、设备）' },
  { value: 'field', label: '按数据字段（每个字段一项）' },
]
export const BUCKETS = [
  { value: 'none', label: '不归并（原始数据）' },
  { value: 'hour', label: '按小时' },
  { value: 'day', label: '按天' },
  { value: 'month', label: '按月' },
]
export const AGGREGATIONS = [
  { value: 'avg', label: '平均值' },
  { value: 'sum', label: '合计' },
  { value: 'max', label: '最大值' },
  { value: 'min', label: '最小值' },
  { value: 'last', label: '最新值' },
  { value: 'first', label: '首个值' },
  { value: 'count', label: '条数' },
  { value: 'delta', label: '期末减期初' },
]
export const ORDERS = [
  { value: 'asc', label: '正序' },
  { value: 'desc', label: '倒序' },
]
export const TIME_FORMATS = [
  { value: 'auto', label: '自动' },
  { value: 'datetime', label: '年-月-日 时:分' },
  { value: 'date', label: '年-月-日' },
  { value: 'month', label: '年-月' },
  { value: 'time', label: '时:分' },
]
export const SUMMARIES = [
  { value: 'none', label: '不加汇总行' },
  { value: 'avg', label: '均值' },
  { value: 'sum', label: '合计' },
  { value: 'max', label: '最大值' },
  { value: 'min', label: '最小值' },
  { value: 'count', label: '计数' },
]
export const PERIOD_OFFSETS = [
  { value: '0', label: '本期' },
  { value: '-1', label: '上期' },
  { value: '-12', label: '去年同期（月报）' },
]

const INLINE_KINDS = new Set<NodeKind>(['condText', 'metricRef'])
const CHART_KINDS = new Set<NodeKind>(['line', 'bar', 'pie'])

/** @param kind 节点种类 */
export function isInlineKind(kind: NodeKind): boolean {
  return INLINE_KINDS.has(kind)
}

/** @param kind 节点种类 */
export function isChartKind(kind: NodeKind): boolean {
  return CHART_KINDS.has(kind)
}

/** @param source 来源取值，`api:` 前缀为第三方接口 */
export function isApiSource(source: string): boolean {
  return source.startsWith('api:')
}

function text(
  attrs: Record<string, unknown>,
  key: string,
  fallback = '',
): string {
  const value = attrs[key]
  return typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : fallback
}

function integer(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) ? value : fallback
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function seriesRows(value: unknown, makeId: () => string): SeriesRow[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((record: unknown) => {
    if (!isRecord(record)) return []
    return [
      {
        id: makeId(),
        table: text(record, 'table'),
        key: text(record, 'key'),
        name: text(record, 'name'),
        offset: integer(record['offset'], 0),
      },
    ]
  })
}

const CHART_VARIANTS: Record<string, NodeKind> = { bar: 'bar', pie: 'pie' }
const PLAIN_KINDS: Record<string, NodeKind> = {
  dsTable: 'dsTable',
  metricRef: 'metricRef',
  condText: 'condText',
}

function nodeKind(node: ReportDocument | null | undefined): NodeKind {
  if (node?.type === 'dsChart')
    return CHART_VARIANTS[text(node.attrs ?? {}, 'kind')] ?? 'line'
  return PLAIN_KINDS[node?.type ?? ''] ?? 'line'
}

/**
 * 从既有节点或空白开始的表单。
 * @param node 要编辑的节点；新插入时为空
 * @param makeId 序列行的界面身份，只作 v-for key
 */
export function formFromNode(
  node: ReportDocument | null | undefined,
  makeId: () => string,
): NodeForm {
  const attrs = node?.attrs ?? {}
  const kind = nodeKind(node)
  const nodeOffset = integer(attrs['offset'], 0)
  const isChart = node?.type === 'dsChart'
  // 图表的期偏移在序列上；节点级偏移并进各序列，避免保存后叠加两次。
  const series = seriesRows(attrs['series'], makeId).map((row) => ({
    ...row,
    offset: isChart ? row.offset + nodeOffset : row.offset,
  }))
  return {
    kind,
    expression: text(attrs, 'expr'),
    precision: text(attrs, kind === 'dsTable' ? 'decimals' : 'precision', '2'),
    unit: text(attrs, 'unit'),
    title: text(attrs, 'title'),
    source: text(attrs, 'table') || series[0]?.table || '',
    keys: stringList(attrs['keys']),
    series,
    xAxis:
      (['category', 'field'] as const).find(
        (axis) => axis === attrs['x_axis'],
      ) ?? 'time',
    categoryKey: text(attrs, 'category_key'),
    bucket: text(attrs, 'bucket', 'none'),
    agg: text(attrs, 'agg', 'avg'),
    order: text(attrs, 'order', 'asc'),
    timeFormat: text(attrs, 'time_format', 'auto'),
    summary: text(attrs, 'summary', 'none'),
    window: text(attrs, 'window'),
    offset: isChart ? 0 : nodeOffset,
    limit: text(attrs, 'limit', '100'),
  }
}

function validInteger(value: string, min: number, max: number): boolean {
  return /^\d+$/.test(value) && Number(value) >= min && Number(value) <= max
}

function inlineError(form: NodeForm): string {
  if (!form.expression.trim()) return '请填写表达式或点选下方指标'
  return validInteger(form.precision, 0, 12) ? '' : '小数位数应为 0–12'
}

function tableError(form: NodeForm): string {
  if (!form.source || !form.keys.length) return '请选择数据来源和要显示的列'
  return validInteger(form.precision, 0, 12) ? '' : '小数位数应为 0–12'
}

function chartError(form: NodeForm): string {
  const sources = new Set(form.series.map((row) => row.table))
  const rules: [boolean, string][] = [
    [
      !form.series.length || form.series.some((row) => !row.key || !row.table),
      '请至少添加一个数据序列并选择字段',
    ],
    [
      form.kind === 'pie' && form.xAxis === 'time',
      '饼图请选择按分类字段或按数据字段展示',
    ],
    [form.xAxis === 'category' && !form.categoryKey, '请选择横轴的分类字段'],
    [
      form.xAxis === 'category' && sources.size > 1,
      '按分类展示时所有序列必须来自同一个数据来源',
    ],
  ]
  return rules.find(([failed]) => failed)?.[1] ?? ''
}

/**
 * 第一条阻止插入的原因；空串表示可以插入。
 * @param form 当前表单
 */
export function formError(form: NodeForm): string {
  if (isInlineKind(form.kind)) return inlineError(form)
  if (!validInteger(form.limit, 1, 1000)) return '最多显示条数应为 1–1000'
  return form.kind === 'dsTable' ? tableError(form) : chartError(form)
}

function displayAttrs(form: NodeForm): Record<string, unknown> {
  const api = isApiSource(form.source)
  return {
    title: form.title.trim(),
    bucket: form.bucket,
    agg: form.agg,
    order: form.order,
    time_format: form.timeFormat,
    limit: Number(form.limit),
    window: api ? null : form.window.trim() || null,
    anchor: 'period',
  }
}

/**
 * 表单 → 正文节点；保留节点上本表单不管的其余属性。
 * @param form 当前表单
 * @param previous 被编辑的节点
 */
export function nodeFromForm(
  form: NodeForm,
  previous?: ReportDocument | null,
): ReportDocument {
  const kept = previous?.attrs ?? {}
  if (isInlineKind(form.kind)) {
    return {
      type: form.kind,
      attrs: {
        ...kept,
        expr: form.expression,
        precision: Number(form.precision),
        unit: form.kind === 'metricRef' ? form.unit : '',
      },
    }
  }
  if (form.kind === 'dsTable') {
    return {
      type: 'dsTable',
      attrs: {
        ...kept,
        ...displayAttrs(form),
        table: form.source,
        offset: isApiSource(form.source) ? 0 : form.offset,
        keys: form.keys,
        summary: form.summary,
        decimals: Number(form.precision),
      },
    }
  }
  return {
    type: 'dsChart',
    attrs: {
      ...kept,
      ...displayAttrs(form),
      kind: form.kind,
      offset: 0,
      x_axis: form.xAxis,
      category_key: form.xAxis === 'category' ? form.categoryKey : '',
      table: form.series[0]?.table ?? '',
      series: form.series.map((row) => ({
        table: row.table,
        key: row.key,
        name: row.name.trim(),
        offset: isApiSource(row.table) ? 0 : row.offset,
      })),
    },
  }
}
