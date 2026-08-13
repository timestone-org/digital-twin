/**
 * @fileoverview 模型页的展示口径：状态与可靠性的文案、数值格式化、行映射。
 *
 * ⚠ `failed` 行上可能带着上一次成功的评估（重训失败保留上一份产物），
 * 所以「失败」与「有指标」可以同时成立，映射时不许互斥。
 * ⚠ 不带限定词的 MAE / 覆盖率 / R² 一律指**热行**（实际 > 0）：整体口径被大量
 * 「一开机就已达标」的零行灌水，理由见 docs/AC_MODEL_UI_DESIGN.md §0。
 */
import type {
  AcModel,
  AcModelStatus,
  DtIntent,
  DtTableSort,
  ModelErrorStats,
  ModelMetricsBlock,
  ModelPrediction,
  ModelReliability,
} from '@dt/contracts'

import { formatMonthDay, formatDateTime, formatSince } from '@/utils/datetime'

// R² 低于它算「弱」；覆盖率低于它算「区间在撒谎」（标称 0.8）
export const R2_WEAK = 0.3
export const COVERAGE_LOW = 0.7

/** 列表页与详情页共用的「热行」口径说明。 */
export const HOT_METRICS_HELP =
  '只统计「实际达标时长 > 0」的那些开机。半数以上的开机一开机就已达标，' +
  '把它们算进来会让误差看起来比真实情况小得多。'

/** R² 的说明，含「—」的两种成因——写死「重训后可见」在第二种下是错误建议。 */
export const R2_HELP =
  '决定系数：1 = 完美，0 = 与「永远猜平均值」一样，负数 = 比猜平均值还差。' +
  '这里只用热行算。显示「—」有两种可能：这次评估是旧口径算的（重训后补齐），' +
  '或者热行的实际时长没有差异（只有一条热行时就会这样），后者算不出 R²。'

export const HIT_RATE_HELP =
  '判零率 = 零行里被判成 0 的占比；判出率 = 热行里被判成非零的占比。' +
  '判出率低意味着模型在漏报「这次要等」。'

export const MODEL_STATUS_VIEW: Record<
  AcModelStatus,
  { label: string; intent: DtIntent }
> = {
  queued: { label: '排队中', intent: 'info' },
  training: { label: '训练中', intent: 'info' },
  ready: { label: '就绪', intent: 'success' },
  failed: { label: '失败', intent: 'danger' },
}

export const RELIABILITY_VIEW: Record<
  ModelReliability,
  { label: string; intent: DtIntent }
> = {
  reliable: { label: '可靠', intent: 'success' },
  indicative: { label: '参考', intent: 'warning' },
  weak: { label: '仅供参考', intent: 'danger' },
}

/** 组合的显示写法：serial 升序加号相连，与指标键同形。 */
export function formatSet(serials: readonly string[]): string {
  return [...serials].sort().join('+')
}

/** 分钟数的显示：一位小数，非法值给占位符。 */
export function formatMinutes(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '—'
  }
  return `${value.toFixed(1)} 分钟`
}

/** 覆盖率的显示：百分比整数。 */
export function formatCoverage(value: number): string {
  return `${Math.round(value * 100)}%`
}

/** 占比的显示：百分比整数；null = 分母不存在，给占位符不给 0%。 */
export function formatRate(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '—'
  }
  return `${Math.round(value * 100)}%`
}

/**
 * R² 的显示：两位小数。
 * ⚠ null 给 `—` 不给 0.00，负数照实显示——「比永远猜平均值还差」是真信号。
 * @param value 决定系数，null = 算不出
 */
export function formatR2(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '—'
  }
  return value.toFixed(2)
}

/**
 * R² 的着色：负数危险、弱相关警示、缺席淡化。
 * @param value 决定系数，null = 算不出
 */
export function r2Class(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return 'text-text-disabled'
  }
  if (value < 0) return 'text-state-danger'
  if (value < R2_WEAK) return 'text-state-warning'
  return 'text-text-primary'
}

/**
 * 一条折外预测的**有符号**误差：预测 − 实际。
 * ⚠ 不取绝对值：偏差方向是行动信息，系统性低估会让人按不足的提前量开机。
 * @param row 一条折外预测
 */
export function signedError(row: ModelPrediction): number {
  return row.p50 - row.actual_minutes
}

/** 80% 区间盖住实际值了吗；没盖住的那些就是覆盖率里失手的部分。 */
export function isCovered(row: ModelPrediction): boolean {
  return row.p10 <= row.actual_minutes && row.actual_minutes <= row.p90
}

/** 训练中或排队中：列表页据此决定要不要轮询。 */
export function isModelBusy(model: AcModel): boolean {
  return model.status === 'queued' || model.status === 'training'
}

export interface ModelRow {
  id: string
  name: string
  /** 副行：有提示就说提示，否则说描述——提示优先于描述。 */
  notice: string | null
  description: string | null
  status: AcModelStatus
  statusLabel: string
  statusIntent: DtIntent
  /** 前两个组合键，多出来的写 `+n`；`setsTitle` 给全部。 */
  sets: string
  setsTitle: string
  sample: string
  /** 「热 402 · 零 383」；老评估没有拆分时为 null。 */
  sampleSplit: string | null
  r2: string
  r2Class: string
  mae: string
  coverage: string | null
  isCoverageLow: boolean
  /** 相对训练时间；`trainedTitle` 给绝对时刻。 */
  trained: string
  trainedTitle: string
  /** 数据窗口 `06-01 → 08-10`；任一端缺席为 null。 */
  window: string | null
  /** 排序取值。⚠ null = 缺席，排序时恒排末尾。 */
  sortValues: Record<ModelSortKey, number | null>
  model: AcModel
}

export const MODEL_SORT_KEYS = ['sample', 'r2', 'mae', 'training'] as const
export type ModelSortKey = (typeof MODEL_SORT_KEYS)[number]

/**
 * 模型 → 列表行。⚠ 误差与覆盖率优先取热行统计：整体值被零行灌水。
 * @param models 全量模型
 * @param now 计算「几天前」的参照时刻
 */
export function toModelRows(
  models: readonly AcModel[],
  now: Date = new Date(),
): ModelRow[] {
  return models.map((model) => toModelRow(model, now))
}

function toModelRow(model: AcModel, now: Date): ModelRow {
  const status = MODEL_STATUS_VIEW[model.status]
  const overall = model.metrics?.overall ?? null
  const graded = overall?.hot ?? overall
  return {
    id: model.id,
    name: model.name,
    notice: noticeOf(model),
    description: model.description,
    status: model.status,
    statusLabel: status.label,
    statusIntent: status.intent,
    ...setsOf(model.serving_sets),
    ...sampleCells(model.sample_count, overall),
    ...gradeCells(graded),
    ...trainingCells(model, now),
    sortValues: {
      sample: model.sample_count,
      r2: graded?.r2 ?? null,
      mae: graded?.mae ?? null,
      training: trainedAtMs(model.trained_at),
    },
    model,
  }
}

/** 样本总数与「热 n · 零 m」；老评估没有零行计数时不渲染副行。 */
function sampleCells(total: number | null, overall: ModelMetricsBlock | null) {
  const split =
    overall === null || overall.zero_count === null
      ? null
      : `热 ${overall.hot?.count ?? 0} · 零 ${overall.zero_count}`
  return {
    sample: total === null ? '—' : String(total),
    sampleSplit: split,
  }
}

/** 热行口径的三格；没有评估时一律占位符，不给 0。 */
function gradeCells(graded: ModelErrorStats | null) {
  return {
    r2: formatR2(graded?.r2),
    r2Class: r2Class(graded?.r2),
    mae: graded === null ? '—' : formatMinutes(graded.mae),
    coverage: graded === null ? null : formatCoverage(graded.coverage),
    isCoverageLow: graded !== null && graded.coverage < COVERAGE_LOW,
  }
}

function trainingCells(model: AcModel, now: Date) {
  const at = model.trained_at
  return {
    trained: at === null ? '未训练' : formatSince(at, now),
    trainedTitle: formatDateTime(at, '未训练'),
    window: windowOf(model),
  }
}

function trainedAtMs(at: string | null): number | null {
  return at === null ? null : Date.parse(at)
}

/** 前两个组合键 + `+n`，标题里给全部（换行拼接）。 */
function setsOf(sets: readonly (readonly string[])[]): {
  sets: string
  setsTitle: string
} {
  const keys = sets.map(formatSet)
  const shown = keys.slice(0, 2).join(' · ')
  const rest = keys.length - 2
  return {
    sets: rest > 0 ? `${shown} +${rest}` : shown,
    setsTitle: keys.join('\n'),
  }
}

function windowOf(model: AcModel): string | null {
  if (model.window_start === null || model.window_end === null) return null
  return `${formatMonthDay(model.window_start)} → ${formatMonthDay(model.window_end)}`
}

/** 一行要说的那件最要紧的事：失败原因 > 数据已更新 > 特征口径已更新。 */
function noticeOf(model: AcModel): string | null {
  if (model.status === 'failed' && model.error !== null) return model.error
  if (model.is_batch_stale) return '数据已更新，可重训'
  if (model.is_feature_stale) return '特征口径已更新，建议重训'
  return null
}

/**
 * 列表排序。整数组在手，纯客户端做，不发请求。
 * ⚠ null 恒排末尾且与 `desc` 无关：否则「按 R² 排序」会把一堆老评估顶到最前，
 * 正好挡住用户想看的东西。默认序是新建的在最上。
 * @param rows 已映射的行
 * @param sort 当前排序态，null = 默认序
 */
export function sortModelRows(
  rows: readonly ModelRow[],
  sort: DtTableSort | null,
): ModelRow[] {
  const copy = [...rows]
  if (sort === null || !isModelSortKey(sort.key)) {
    return copy.sort((left, right) =>
      right.model.created_at.localeCompare(left.model.created_at),
    )
  }
  const key = sort.key
  return copy.sort((left, right) =>
    compareNullLast(left.sortValues[key], right.sortValues[key], sort.desc),
  )
}

function isModelSortKey(key: string): key is ModelSortKey {
  return (MODEL_SORT_KEYS as readonly string[]).includes(key)
}

function compareNullLast(
  left: number | null,
  right: number | null,
  desc: boolean,
): number {
  if (left === null && right === null) return 0
  if (left === null) return 1
  if (right === null) return -1
  return desc ? right - left : left - right
}

/** 按组合分组的评估行。⚠ block 为 null = 没样本，不是零误差。 */
export interface SetMetricsRow {
  id: string
  set: string
  /** 「热 n / 零 m」；老评估没有拆分时退回总数。 */
  count: string
  /** 热行 R² / MAE / 覆盖率 / 区间宽度；没有热行（或老评估）退回整体值。 */
  r2: string
  r2Class: string
  mae: string
  coverage: string
  width: string
  zeroHit: string
  hotHit: string
  reliabilityLabel: string
  reliabilityIntent: DtIntent
  hasSamples: boolean
}

/** 分组评估 → 表行，键序即行序。误差列优先取热行统计。 */
export function toSetRows(
  bySet: Record<string, ModelMetricsBlock | null>,
): SetMetricsRow[] {
  return Object.entries(bySet).map(([key, block]) =>
    block === null ? emptySetRow(key) : filledSetRow(key, block),
  )
}

/** 勾了却没攒到事件的组合。⚠ 照常列出：藏起来等于说「这个组合没问题」。 */
function emptySetRow(key: string): SetMetricsRow {
  return {
    id: key,
    set: key,
    count: '0',
    r2: '—',
    r2Class: 'text-text-disabled',
    mae: '—',
    coverage: '—',
    width: '—',
    zeroHit: '—',
    hotHit: '—',
    reliabilityLabel: '无样本',
    reliabilityIntent: 'neutral',
    hasSamples: false,
  }
}

function filledSetRow(key: string, block: ModelMetricsBlock): SetMetricsRow {
  const graded = block.hot ?? block
  const reliability = RELIABILITY_VIEW[graded.reliability]
  return {
    id: key,
    set: key,
    count:
      block.zero_count === null
        ? String(block.count)
        : `热 ${block.hot?.count ?? 0} / 零 ${block.zero_count}`,
    r2: formatR2(graded.r2),
    r2Class: r2Class(graded.r2),
    mae: formatMinutes(graded.mae),
    coverage: formatCoverage(graded.coverage),
    width: formatMinutes(graded.mean_width),
    zeroHit: formatRate(block.zero_hit_rate),
    hotHit: formatRate(block.hot_hit_rate),
    reliabilityLabel: reliability.label,
    reliabilityIntent: reliability.intent,
    hasSamples: true,
  }
}
