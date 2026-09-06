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

/** 这一帧是从哪儿、哪一段时间取来的。数字看着不对时先看它。 */
export interface FrameProvenance {
  tableCodes: string[]
  since: string | null
  until: string | null
  /** 取数触了行数上限——后面的数据根本没进来。 */
  isTruncated: boolean
}

/** 一份帧的摘要。 */
export interface FramePreview {
  kind: 'frame'
  rowCount: number
  colCount: number
  columns: ColumnStat[]
  indexName: string
  /**
   * 时间索引的前若干行，**ISO 时刻串**。
   *
   * ⚠ 后端给的是毫秒时间戳整数（`Frame.index`），按字符串读会整列读成空串，
   * 表现是时间那一列一片空白而其余列都正常。
   */
  indexHead: string[]
  head: unknown[][]
  isRowsTruncated: boolean
  isColsTruncated: boolean
  provenance: FrameProvenance
}

/** 一个模型的摘要。 */
export interface ModelPreview {
  kind: 'model'
  algo: string
  task: string
  featureKeys: string[]
  targetKey: string
  hyperParams: [string, string][]
  /**
   * 真训出模型来了没有。
   *
   * ⚠ 判据是**可服务通道**，不是 `fitted` 空不空：通道 B 的模型本体在二进制
   * 产物里、`fitted` 刻意留空（`operators/trees.py::run`），按空不空判会把每一
   * 个训练成功的树模型说成没训出来。
   */
  isFitted: boolean
  /**
   * ⚠ 与 `isFitted` 分开：摘要撑爆字节预算时后端会把拟合参数整个摘掉
   * （`preview.py::_stripped`），那时「看不到系数」与「没训练出来」是两回事，
   * 混作一处会让一个跑成功的模型在界面上被说成没训出来。通道 B 本来就没有
   * 可看的系数，不算被削。
   */
  isFittedTrimmed: boolean
  /** 特征列 → 权重。算法不给系数时为空。 */
  coefficients: [string, number][]
  /** 两类模型的类目，升序；正类是后一个。算法不给类目时为空。 */
  classes: number[]
  intercept: number | null
  servingChannel: string
}

/** 残差直方图的一根柱：这个区间里落了多少行。 */
export interface ResidualBin {
  low: number
  high: number
  count: number
}

/** 一次评估的摘要。`pairs` 是画散点用的真值/预测值。 */
export interface MetricsPreview {
  kind: 'metrics'
  task: string
  /** ⚠ 值可能是 null：R² 与 MAPE 在无定义时给 null，显示成 0 是假数。 */
  metrics: [string, number | null][]
  pairs: [number, number][]
  /** 点太多，后端只带回了其中一部分。 */
  isPairsTruncated: boolean
  /**
   * ⚠ 与 `isPairsTruncated` 分开：摘要撑爆字节预算时后端把 `pairs` 整个摘掉却
   * 原样留着 `pairs_truncated`（`preview.py::_stripped`），只读后者的话那张散点
   * 图会无声消失。指标本身仍是按全部数据算的。
   */
  isPairsTrimmed: boolean
  residualBins: ResidualBin[]
  /** 分类的类目，升序。回归评估里是空的。 */
  labels: string[]
  /**
   * 混淆矩阵：第 i 行第 j 列 = 真实第 i 类被判成第 j 类的行数。
   *
   * ⚠ 行是真实、列是预测（后端 `evaluate._confusion`）。按列是真实读的话，
   * 精确率与召回率会整个换位，而对称矩阵上看不出任何异样。
   * ⚠ 读不出数的那一格给 null 不给 0：矩阵的形状比某一格的值要紧，按 0 补会把
   * 一份读坏的矩阵显示成一份算得出准确率的矩阵（`matrixStats` 照实报错）。
   */
  matrix: (number | null)[][]
}

/** 认不出来的摘要，照实说明。 */
export interface UnknownPreview {
  kind: 'unknown'
  note: string
}

export type Preview =
  FramePreview | ModelPreview | MetricsPreview | UnknownPreview

// 通道 B：模型本体是一份二进制产物，拟合参数不进 JSON
const CHANNEL_BINARY = 'binary'

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

/** 毫秒时间戳的列表读成 ISO 时刻串。认不出的那一格给空串。 */
function momentsOf(value: unknown): string[] {
  return asList(value).map((item) => {
    const at = asNumber(item)
    return at === null ? '' : new Date(at).toISOString()
  })
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

function provenanceOf(raw: unknown): FrameProvenance {
  const item = asRecord(raw)
  const since = asText(item['since'])
  const until = asText(item['until'])
  return {
    tableCodes: asTexts(item['table_codes']),
    since: since === '' ? null : since,
    until: until === '' ? null : until,
    isTruncated: item['is_truncated'] === true,
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
    indexHead: momentsOf(raw['index_head']),
    head: asList(raw['head']).map((row) => asList(row)),
    isRowsTruncated: raw['rows_truncated'] === true,
    isColsTruncated: raw['cols_truncated'] === true,
    provenance: provenanceOf(raw['provenance']),
  }
}

/** 拟合参数里的系数表。算法不给 `coef` 时为空——那不算出错。 */
function coefficientsOf(fitted: Record<string, unknown>): [string, number][] {
  const pairs: [string, number][] = []
  for (const [key, value] of Object.entries(asRecord(fitted['coef']))) {
    const number = asNumber(value)
    if (number !== null) pairs.push([key, number])
  }
  return pairs
}

/** 两个类目。读不出数的那一项丢掉——正类方向按它判，混进 NaN 会判反。 */
function classesOf(fitted: Record<string, unknown>): number[] {
  const values: number[] = []
  for (const item of asList(fitted['classes'])) {
    const value = asNumber(item)
    if (value !== null) values.push(value)
  }
  return values
}

function modelOf(raw: Record<string, unknown>): ModelPreview {
  // ⚠ 后端给的 `fitted` 是一份**拟合参数字典**，不是布尔。按布尔读的话每个训
  // 好的模型都会被说成没训出来，而这是一条只在真跑过之后才看得见的错
  const hasFitted = 'fitted' in raw
  const fitted = asRecord(raw['fitted'])
  const channel = asText(raw['serving_channel'])
  const isBinary = channel === CHANNEL_BINARY
  return {
    kind: 'model',
    algo: asText(raw['algo']),
    task: asText(raw['task']),
    featureKeys: asTexts(raw['feature_keys']),
    targetKey: asText(raw['target_key']),
    hyperParams: Object.entries(asRecord(raw['hyper_params'])).map(
      ([key, value]) => [key, String(value)],
    ),
    isFitted: isBinary || (hasFitted && Object.keys(fitted).length > 0),
    isFittedTrimmed: !hasFitted && !isBinary,
    coefficients: coefficientsOf(fitted),
    classes: classesOf(fitted),
    intercept: asNumber(fitted['intercept']),
    servingChannel: channel,
  }
}

function residualBinsOf(raw: unknown): ResidualBin[] {
  const bins: ResidualBin[] = []
  for (const item of asList(raw)) {
    const bin = asList(item)
    const low = asNumber(bin[0])
    const high = asNumber(bin[1])
    const count = asNumber(bin[2])
    if (low !== null && high !== null && count !== null) {
      bins.push({ low, high, count })
    }
  }
  return bins
}

/** 矩阵按行读，形状原样留着：某一格读不出来就是 null。 */
function matrixOf(raw: unknown): (number | null)[][] {
  return asList(raw).map((row) => asList(row).map((cell) => asNumber(cell)))
}

function metricsOf(raw: Record<string, unknown>): MetricsPreview {
  const pairs: [number, number][] = []
  for (const item of asList(raw['pairs'])) {
    const pair = asList(item)
    const left = asNumber(pair[0])
    const right = asNumber(pair[1])
    if (left !== null && right !== null) pairs.push([left, right])
  }
  // ⚠ 值为 null 的指标要留着：R² 与 MAPE 在无定义时后端给的就是 null，
  // 丢掉它等于把「算不出来」显示成「没有这个指标」
  const metrics: [string, number | null][] = Object.entries(
    asRecord(raw['metrics']),
  ).map(([key, value]) => [key, asNumber(value)])
  return {
    kind: 'metrics',
    task: asText(raw['task']),
    metrics,
    pairs,
    isPairsTruncated: raw['pairs_truncated'] === true,
    isPairsTrimmed: !('pairs' in raw),
    residualBins: residualBinsOf(raw['residual_bins']),
    labels: asTexts(raw['labels']),
    matrix: matrixOf(raw['matrix']),
  }
}

/** 一个节点的一路输出：端口名与它那份摘要。 */
export interface PortPreview {
  port: string
  preview: Preview
}

/**
 * 把一个节点的结果摘要读成**逐端口**的清单。
 *
 * ⚠ 后端给的摘要是**按端口建键**的（取数是 `{frame: {…}}`，切分是
 * `{train: {…}, test: {…}}`，回归是 `{model: {…}, scored: {…}}`），不是一份
 * 摊平的摘要。拿整包去读 `kind` 永远读不到，界面于是把每一步都显示成
 * 「这一步没有可展示的结果」——而卡片上那行数字也跟着一起空掉。
 */
export function portPreviewsOf(raw: Record<string, unknown>): PortPreview[] {
  return Object.entries(raw).map(([port, value]) => ({
    port,
    preview: previewOf(asRecord(value)),
  }))
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
