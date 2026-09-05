/**
 * @fileoverview 节点讲解 `report` 的类型与读取器：读不出来的照实退化，不猜。
 *
 * ⚠ 块的内部形状没有 openapi 保护，键名写错时 typecheck 与 lint 双双放行，
 * 两侧花名册由 `tests/contract/modeling-blocks.contract.spec.ts` 双向钉住。
 * ⚠ 四个通用扩展键（规格 §4.3）各有归属：`is_primary` 在这里读成块上的一个
 * 字段（它决定图摆主体位还是辅图格，是版式的事）；`notes` 归 `blockNotes.ts`；
 * `degraded` 与 `degraded_reason` 归 `ledgerBlocks.ts`。
 */
import type { ReportZone } from './zones'
import { isReportZone } from './zones'

/** 八种块，一种回答一个问题。⚠ 与后端 `reporting.py::BLOCK_KINDS` 逐字对齐。 */
export const BLOCK_KINDS = [
  'rows',
  'columns',
  'cells',
  'fits',
  'bins',
  'axis',
  'breakdown',
  'structure',
] as const

export type BlockKind = (typeof BLOCK_KINDS)[number]

export function isBlockKind(value: string): value is BlockKind {
  return BLOCK_KINDS.some((kind) => kind === value)
}

/**
 * 四种「没有」，一档都不许合并（规格 §2-P5）。
 *
 * ⚠ 措辞、位置与语气各不相同：合成一句「数据不全」之后，用户分不出该去调
 * 取数范围、还是这一屏本来就少画了一块。
 */
export const TRUNCATION_KINDS = [
  'source',
  'budget',
  'upstream',
  'missing',
] as const

export type TruncationKind = (typeof TRUNCATION_KINDS)[number]

// 分区认不出来的块摆进第一区：至少它会被看见，而两侧漂了有契约用例逮
const FALLBACK_ZONE: ReportZone = 'step'

type Item = Record<string, unknown>

/** 结果面上的一块。六个字段与后端 `ReportBlock` 一一对应。 */
export interface ReportBlock {
  /** ⚠ 留成字符串：认不出的那种要原样交给兜底画法，不是丢掉。 */
  kind: string
  zone: ReportZone
  /** 空串 = 节点级，不属于任何一路输出。 */
  port: string
  title: string
  tier: number
  /**
   * 这张图是不是这一步的主体图。
   *
   * ⚠ 缺省是 null 不是 true：`zone === 'charts'` 的块必带这个键，漏标由后端
   * 契约逐个算子拦下。前端把「没标」与「标了 false」画成同一档，才不会让
   * 同一条降档梯子在不同算子上摆出不同的版面（规格 §4.3）。
   */
  isPrimary: boolean | null
  payload: Item
}

/** 一个节点这一步讲的话。 */
export interface NodeReport {
  blocks: ReportBlock[]
  /** 超预算时被降档丢掉的那些块的标题。 */
  dropped: string[]
  note: string
}

function isRecord(value: unknown): value is Item {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 把一份来路不明的值读成对象。读不出来就是空对象，不是抛错。 */
export function recordOf(value: unknown): Item {
  return isRecord(value) ? value : {}
}

function asList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
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

/** 布尔键：没写就是 null，不折成 false——「没标」与「标了不是」要分得开。 */
function asFlag(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function asTexts(value: unknown): string[] {
  return asList(value).map((item) => asText(item))
}

function asItems(value: unknown): Item[] {
  return asList(value).map((item) => recordOf(item))
}

/** 一串数里读不出来的那几个丢掉——桶高混进 NaN 会让整张图算不出跨度。 */
function asNumbers(value: unknown): number[] {
  const kept: number[] = []
  for (const item of asList(value)) {
    const number = asNumber(item)
    if (number !== null) kept.push(number)
  }
  return kept
}

/** 读一个节点的讲解。整包读不出来就是零个块，界面退化成没有讲解的样子。 */
export function reportOf(raw: Item | null | undefined): NodeReport {
  const source = recordOf(raw)
  return {
    blocks: asList(source['blocks']).map((item) => blockOf(item)),
    dropped: asTexts(source['dropped']),
    note: asText(source['note']),
  }
}

function blockOf(raw: unknown): ReportBlock {
  const item = recordOf(raw)
  const zone = asText(item['zone'])
  const payload = recordOf(item['payload'])
  return {
    kind: asText(item['kind']),
    zone: isReportZone(zone) ? zone : FALLBACK_ZONE,
    port: asText(item['port']),
    title: asText(item['title']),
    tier: asCount(item['tier']),
    isPrimary: asFlag(payload['is_primary']),
    payload,
  }
}

/** 行数账：进来多少、出去多少、丢的那些是谁的锅。 */
export interface RowCounts {
  before: number
  after: number
  dropped: number
  droppedBlank: number
  /** 用户配的那个比例；null = 这个算子没有比例参数。 */
  ratioConfigured: number | null
  /** ⚠ 与配的那个分开：两者差得远时用户才有得追。 */
  ratioActual: number | null
  funnel: Item[]
  byColumn: Item[]
}

export function rowsOf(payload: Item): RowCounts {
  return {
    before: asCount(payload['before']),
    after: asCount(payload['after']),
    dropped: asCount(payload['dropped']),
    droppedBlank: asCount(payload['dropped_blank']),
    ratioConfigured: asNumber(payload['ratio_configured']),
    ratioActual: asNumber(payload['ratio_actual']),
    funnel: asItems(payload['funnel']),
    byColumn: asItems(payload['by_column']),
  }
}

/** 列的去向：多出来的是谁造的、少掉的是谁删的。 */
export interface ColumnChange {
  added: string[]
  removed: string[]
  kept: number
  dtypeBefore: Item[]
  reason: string
}

export function columnsOf(payload: Item): ColumnChange {
  return {
    added: asTexts(payload['added']),
    removed: asTexts(payload['removed']),
    kept: asCount(payload['kept']),
    dtypeBefore: asItems(payload['dtype_before']),
    reason: asText(payload['reason']),
  }
}

/** 一列上默默改过的那些格。 */
export interface CellChange {
  key: string
  changed: number
  low: number | null
  high: number | null
  /** 改之前的原值样例，给用户核对用。读不出的那一个留成 null。 */
  samples: (string | number | null)[]
}

export function cellsOf(payload: Item): CellChange[] {
  return asItems(payload['by_column']).map((item) => ({
    key: asText(item['key']),
    changed: asCount(item['changed']),
    low: asNumber(item['low']),
    high: asNumber(item['high']),
    samples: asList(item['samples']).map((value) =>
      typeof value === 'string' ? value : asNumber(value),
    ),
  }))
}

/** 学到了什么、能不能核对。 */
export interface FitSummary {
  method: string
  /** ⚠ 与总行数分开：统计量只在将来会进训练集的行上学，两个数不一样才是对的。 */
  trainRows: number
  totalRows: number
  byColumn: Item[]
}

export function fitsOf(payload: Item): FitSummary {
  return {
    method: asText(payload['method']),
    trainRows: asCount(payload['train_rows']),
    totalRows: asCount(payload['total_rows']),
    byColumn: asItems(payload['by_column']),
  }
}

/** 图上的一条参考线。 */
export interface BinMark {
  at: number
  label: string
  intent: string
}

/** 一列的分布：桶高、几条参考线、以及落在轴外的那一撮。 */
export interface ColumnBins {
  key: string
  bins: number[]
  marks: BinMark[]
  /** 落不到这条数轴上的那些行（空值等）；null = 没有。 */
  offAxis: { label: string; count: number } | null
}

export function binsOf(payload: Item): ColumnBins[] {
  return asItems(payload['by_column']).map((item) => ({
    key: asText(item['key']),
    bins: asNumbers(item['bins']),
    marks: markOf(item['marks']),
    offAxis: offAxisOf(item['off_axis']),
  }))
}

/** 位置读不出来的参考线丢掉：画在 0 处的一条线会被读成「阈值是 0」。 */
function markOf(raw: unknown): BinMark[] {
  const kept: BinMark[] = []
  for (const item of asItems(raw)) {
    const at = asNumber(item['at'])
    if (at === null) continue
    kept.push({
      at,
      label: asText(item['label']),
      intent: asText(item['intent']),
    })
  }
  return kept
}

function offAxisOf(raw: unknown): { label: string; count: number } | null {
  if (!isRecord(raw)) return null
  return { label: asText(raw['label']), count: asCount(raw['count']) }
}

/** 时间轴被怎么动了。 */
export interface TimeAxis {
  bucketMs: number | null
  /** ⚠ 按 UTC 切一天在东八区会整体偏 8 小时，而每个数看着都完全正常。 */
  tzOffsetMinutes: number
  /** 实际取到的起止，RFC3339 UTC。⚠ 不是请求的起止：触顶时两者差得很远。 */
  actualSince: string | null
  actualUntil: string | null
  occupancy: number[]
  gaps: Item[]
  segments: Item[]
}

export function axisOf(payload: Item): TimeAxis {
  const since = asText(payload['actual_since'])
  const until = asText(payload['actual_until'])
  return {
    bucketMs: asNumber(payload['bucket_ms']),
    tzOffsetMinutes: asCount(payload['tz_offset_minutes']),
    actualSince: since === '' ? null : since,
    actualUntil: until === '' ? null : until,
    occupancy: asNumbers(payload['occupancy']),
    gaps: asItems(payload['gaps']),
    segments: asItems(payload['segments']),
  }
}

/** 按项的一组数里的一项。 */
export interface BreakdownItem {
  name: string
  /** ⚠ 留 null：算不出来的那一项显示成 0 是假数。 */
  value: number | null
  spread: number | null
}

/** 按项的一组数是什么口径。界面据它决定要不要按阈值染色。 */
export interface Breakdown {
  label: string
  unit: string
  /** 空串 = 没有公认的好坏线，一律灰。 */
  scoreKind: string
  baseline: number | null
  items: BreakdownItem[]
}

export function breakdownOf(payload: Item): Breakdown {
  return {
    label: asText(payload['label']),
    unit: asText(payload['unit']),
    scoreKind: asText(payload['score_kind']),
    baseline: asNumber(payload['baseline']),
    items: asItems(payload['items']).map((item) => ({
      name: asText(item['name']),
      value: asNumber(item['value']),
      spread: asNumber(item['spread']),
    })),
  }
}

/** 一个特征的部分依赖曲线。 */
export interface PdpCurve {
  key: string
  points: [number, number][]
}

/** 模型内部长什么样。六样各自可缺。 */
export interface ModelStructure {
  importances: Item[]
  ranges: Item[]
  tree: Item | null
  pdp: PdpCurve[]
  loadings: number[][]
  explained: number[]
}

export function structureOf(payload: Item): ModelStructure {
  return {
    importances: asItems(payload['importances']),
    ranges: asItems(payload['ranges']),
    tree: isRecord(payload['tree']) ? payload['tree'] : null,
    pdp: asItems(payload['pdp']).map((item) => ({
      key: asText(item['key']),
      points: pointsOf(item['points']),
    })),
    loadings: asList(payload['loadings']).map((row) => asNumbers(row)),
    explained: asNumbers(payload['explained']),
  }
}

/** 缺一个坐标的点丢掉：补 0 会在曲线上多出一个不存在的拐点。 */
function pointsOf(raw: unknown): [number, number][] {
  const kept: [number, number][] = []
  for (const item of asList(raw)) {
    const pair = asList(item)
    const x = asNumber(pair[0])
    const y = asNumber(pair[1])
    if (x !== null && y !== null) kept.push([x, y])
  }
  return kept
}

/**
 * 概率侧那四块，按逐项带的键认出来。
 *
 * ⚠ 认键不认标题：标题是给人读的一句话，改一个字就换一张画法的话，这条接线
 * 早晚会哑掉，而哑掉的样子是曲线退回成一排横条——不报错也不白屏。
 */
export const CURVE_KINDS = ['roc', 'pr', 'calibration', 'grid'] as const

export type CurveKind = (typeof CURVE_KINDS)[number]

/** 四块各认哪两个键。⚠ 与后端 `evalcurves.py` 的四个 `*_items` 逐字对齐。 */
const CURVE_KEYS: readonly (readonly [CurveKind, readonly string[]])[] = [
  ['roc', ['fpr', 'tpr']],
  ['pr', ['recall', 'precision']],
  ['calibration', ['predicted', 'actual']],
  ['grid', ['tp', 'fn']],
]

/** 概率侧一项上那些键，四块共用一副读取器。缺的一律 null，不折成 0。 */
export interface ProbabilityItem {
  name: string
  /** ROC 的第一个点是「全判负类」那个锚点，它没有阈值。 */
  threshold: number | null
  fpr: number | null
  tpr: number | null
  recall: number | null
  precision: number | null
  predicted: number | null
  actual: number | null
  count: number | null
  /** 这一箱里不足十行：点画空心，别照它下结论。 */
  isSparse: boolean
  truePositive: number | null
  falsePositive: number | null
  trueNegative: number | null
  falseNegative: number | null
}

/** 这一块是不是概率侧那四块之一；不是就给 null，交回原来的横条画法。 */
export function curveKindOf(payload: Item): CurveKind | null {
  const [first] = asItems(payload['items'])
  if (first === undefined) return null
  for (const [kind, keys] of CURVE_KEYS) {
    if (keys.every((key) => key in first)) return kind
  }
  return null
}

/** 概率侧一块的逐项。Args: payload。 */
export function probabilityItemsOf(payload: Item): ProbabilityItem[] {
  return asItems(payload['items']).map((item) => ({
    name: asText(item['name']),
    threshold: asNumber(item['threshold']),
    fpr: asNumber(item['fpr']),
    tpr: asNumber(item['tpr']),
    recall: asNumber(item['recall']),
    precision: asNumber(item['precision']),
    predicted: asNumber(item['predicted']),
    actual: asNumber(item['actual']),
    count: asNumber(item['count']),
    isSparse: item['is_sparse'] === true,
    truePositive: asNumber(item['tp']),
    falsePositive: asNumber(item['fp']),
    trueNegative: asNumber(item['tn']),
    falseNegative: asNumber(item['fn']),
  }))
}
