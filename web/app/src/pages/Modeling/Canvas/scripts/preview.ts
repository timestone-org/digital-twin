/**
 * @fileoverview 把节点结果摘要读成前端要的形状。
 *
 * ⚠ 派发**只认 `kind`**，不做结构嗅探：靠「有没有 metrics 这个键」去猜的话，
 * 将来任何一个算子的摘要多带一个同名键，界面就会安静地换成另一种视图
 * （MODELING_DESIGN §9.4）。
 */
/** 一列的统计。非数值列的四个数是 null。 */
export interface ColumnStat {
  key: string
  name: string
  dtype: string
  role: string
  unit: string
  nullRatio: number
  uniqueCount: number
  min: number | null
  max: number | null
  mean: number | null
  p50: number | null
}

/** 一份帧的摘要。 */
export interface FramePreview {
  kind: 'frame'
  rowCount: number
  colCount: number
  columns: ColumnStat[]
  indexName: string
  indexHead: string[]
  head: unknown[][]
  isRowsTruncated: boolean
  isColsTruncated: boolean
}

/** 一个模型的摘要。 */
export interface ModelPreview {
  kind: 'model'
  algo: string
  task: string
  featureKeys: string[]
  targetKey: string
  hyperParams: [string, string][]
  isFitted: boolean
}

/** 一次评估的摘要。`pairs` 是画散点用的真值/预测值。 */
export interface MetricsPreview {
  kind: 'metrics'
  task: string
  metrics: [string, number][]
  pairs: [number, number][]
  isPairsTruncated: boolean
}

/** 认不出来的摘要，照实说明。 */
export interface UnknownPreview {
  kind: 'unknown'
  note: string
}

export type Preview =
  FramePreview | ModelPreview | MetricsPreview | UnknownPreview

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function asCount(value: unknown): number {
  return asNumber(value) ?? 0
}

function asList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function asTexts(value: unknown): string[] {
  return asList(value).map((item) => asText(item))
}

function columnStatOf(raw: unknown): ColumnStat {
  const item = asRecord(raw)
  return {
    key: asText(item['key']),
    name: asText(item['name']),
    dtype: asText(item['dtype']),
    role: asText(item['role']),
    unit: asText(item['unit']),
    nullRatio: asCount(item['null_ratio']),
    uniqueCount: asCount(item['n_unique']),
    min: asNumber(item['min']),
    max: asNumber(item['max']),
    mean: asNumber(item['mean']),
    p50: asNumber(item['p50']),
  }
}

function frameOf(raw: Record<string, unknown>): FramePreview {
  const shape = asRecord(raw['shape'])
  return {
    kind: 'frame',
    rowCount: asCount(shape['rows']),
    colCount: asCount(shape['cols']),
    columns: asList(raw['columns']).map(columnStatOf),
    indexName: asText(raw['index_name']),
    indexHead: asTexts(raw['index_head']),
    head: asList(raw['head']).map((row) => asList(row)),
    isRowsTruncated: raw['rows_truncated'] === true,
    isColsTruncated: raw['cols_truncated'] === true,
  }
}

function modelOf(raw: Record<string, unknown>): ModelPreview {
  return {
    kind: 'model',
    algo: asText(raw['algo']),
    task: asText(raw['task']),
    featureKeys: asTexts(raw['feature_keys']),
    targetKey: asText(raw['target_key']),
    hyperParams: Object.entries(asRecord(raw['hyper_params'])).map(
      ([key, value]) => [key, String(value)],
    ),
    isFitted: raw['fitted'] === true,
  }
}

function metricsOf(raw: Record<string, unknown>): MetricsPreview {
  const pairs: [number, number][] = []
  for (const item of asList(raw['pairs'])) {
    const pair = asList(item)
    const left = asNumber(pair[0])
    const right = asNumber(pair[1])
    if (left !== null && right !== null) pairs.push([left, right])
  }
  const metrics: [string, number][] = []
  for (const [key, value] of Object.entries(asRecord(raw['metrics']))) {
    const number = asNumber(value)
    if (number !== null) metrics.push([key, number])
  }
  return {
    kind: 'metrics',
    task: asText(raw['task']),
    metrics,
    pairs,
    isPairsTruncated: raw['pairs_truncated'] === true,
  }
}

/** 读一份摘要。`kind` 认不出来就当 `unknown`。 */
export function previewOf(raw: Record<string, unknown>): Preview {
  const kind = asText(raw['kind'])
  if (kind === 'frame') return frameOf(raw)
  if (kind === 'model') return modelOf(raw)
  if (kind === 'metrics') return metricsOf(raw)
  return {
    kind: 'unknown',
    note: asText(raw['note']) || '这一步没有可展示的结果',
  }
}
