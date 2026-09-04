/**
 * @fileoverview 指标好不好：把一个数折成三档色，并给出它的中文名、单位与那句
 * 口径说明。键名的来路（后端定死的指标键 / 按列名建的键）也在这里判。
 *
 * ⚠ 分档必须**逐指标**定方向：R² 越大越好、MAPE 越小越好，用同一套阈值去套的话
 * 一个 5% 的 MAPE 会被染成「差」，而那其实是很好的结果。
 */
import type { DtIntent } from '@dt/contracts'

/** 三档观感。 */
export type MetricBand = 'good' | 'fair' | 'poor' | 'unknown'

/**
 * 这一份指标字典的键是从哪来的。
 *
 * ⚠ `column` 档一律不查阈值表与单位表：`feature_importance` 把**列名**当键塞进
 * 扁平的 metrics 字典，某一列恰好叫 `mape` 时，无量纲的 ΔR²=0.12 会被印成
 * 「0.12%」，叫 `r2` 时还会被套上回归阈值染色（设计规格 R-34）。
 */
export type MetricSpace = 'metric' | 'column'

/** 一个指标的显示口径：中文名、越大越好还是越小越好、两道阈值。 */
interface MetricSpec {
  label: string
  /** true = 越大越好。 */
  higherIsBetter: boolean
  good: number
  fair: number
}

const SPECS: Record<string, MetricSpec> = {
  r2: { label: 'R²', higherIsBetter: true, good: 0.9, fair: 0.7 },
  // ⚠ MAPE 后端已经乘过 100，阈值按百分数写；按小数写会把 8% 判成「差」
  mape: { label: 'MAPE', higherIsBetter: false, good: 10, fair: 20 },
  accuracy: { label: '准确率', higherIsBetter: true, good: 0.9, fair: 0.75 },
  precision: { label: '精确率', higherIsBetter: true, good: 0.9, fair: 0.75 },
  recall: { label: '召回率', higherIsBetter: true, good: 0.9, fair: 0.75 },
  f1: { label: 'F1', higherIsBetter: true, good: 0.9, fair: 0.75 },
}

/** 跟着目标列的量纲走的那些数，换一列就不是同一个量级。 */
const SCALED = '好坏取决于这一列的量纲，这里不替你下结论'
/** 无量纲、但也没有公认的好坏线（规格 §2-P3）。 */
const NO_LINE = '这个数没有公认的好坏线'
/** 每折的分是什么，`diagnostics.py::_fold_score`。 */
const FOLD_SCORE = `每折的分：回归是 R²、分类是准确率。${NO_LINE}`

/** 没有分档口径的那些：中文名 + 为什么不给它一个颜色。 */
interface PlainSpec {
  label: string
  hint: string
}

const PLAIN: Record<string, PlainSpec> = {
  mae: { label: 'MAE', hint: SCALED },
  rmse: { label: 'RMSE', hint: SCALED },
  max_error: { label: '最大误差', hint: SCALED },
  residual_mean: { label: '偏均值', hint: SCALED },
  residual_std: { label: '离散度', hint: SCALED },
  residual_p05: { label: '5% 分位', hint: SCALED },
  residual_p95: { label: '95% 分位', hint: SCALED },
  residual_max_abs: { label: '最大绝对误差', hint: SCALED },
  folds: {
    label: '实得折数',
    hint: '前向链的第一折没有可训的行，实得会比配置的折数少一折',
  },
  score_mean: { label: '平均分', hint: FOLD_SCORE },
  score_std: { label: '分数波动', hint: NO_LINE },
  score_worst: { label: '最差一折', hint: FOLD_SCORE },
}

/** 这个键是不是后端定死的那些指标键之一。 */
function isKnown(key: string): boolean {
  return key in SPECS || key in PLAIN
}

/**
 * 一份指标字典的键空间。有一个键认不出来就整份当 `column`。
 *
 * ⚠ 只兜到「按列名建的键里至少有一个不是指标名」为止：唯一一列恰好叫 `mape`
 * 的重要性表仍会被当成指标。根治是后端把列名搬进 `breakdown` 块（规格 §4.3）。
 * Args: keys 这份字典的全部键。
 */
export function metricSpaceOf(keys: readonly string[]): MetricSpace {
  return keys.every(isKnown) ? 'metric' : 'column'
}

/** 指标的中文名。不认识的原样显示，不吞掉。Args: key, space。 */
export function labelOf(key: string, space: MetricSpace = 'metric'): string {
  if (space === 'column') return key
  return SPECS[key]?.label ?? PLAIN[key]?.label ?? key
}

/**
 * 这个数落在哪一档。
 *
 * ⚠ 没有分档口径的指标一律给 `unknown` 而不是 `fair`：MAE 是 3 好不好，只有
 * 知道那一列的量纲才答得上来，替用户拍一个颜色等于给一个没根据的结论。
 * Args: key, value, space。
 */
export function bandOf(
  key: string,
  value: number | null,
  space: MetricSpace = 'metric',
): MetricBand {
  const spec = space === 'column' ? undefined : SPECS[key]
  if (spec === undefined || value === null) return 'unknown'
  const passes = (threshold: number): boolean =>
    spec.higherIsBetter ? value >= threshold : value <= threshold
  if (passes(spec.good)) return 'good'
  return passes(spec.fair) ? 'fair' : 'poor'
}

/** 每一档对应的色档，指标卡照它染色。 */
export const BAND_INTENTS: Record<MetricBand, DtIntent> = {
  good: 'success',
  fair: 'warning',
  poor: 'danger',
  unknown: 'neutral',
}

/** 带单位的那几个指标。MAPE 是百分数。 */
const UNITS: Record<string, string> = { mape: '%' }

/** 这个指标的单位；没有单位给空串。Args: key, space。 */
export function unitOf(key: string, space: MetricSpace = 'metric'): string {
  if (space === 'column') return ''
  return UNITS[key] ?? ''
}

/**
 * 这个指标旁边那句口径说明。
 *
 * ⚠ 认不出的指标给的是「没有公认的好坏线」而不是量纲那句：ΔR² 与 `score_std`
 * 都是无量纲的，说它们取决于量纲是错的提示（规格 §2-P3）。
 * Args: key, space。
 */
export function bandHintOf(key: string, space: MetricSpace = 'metric'): string {
  if (space === 'column') return ''
  const spec = SPECS[key]
  if (spec === undefined) return PLAIN[key]?.hint ?? NO_LINE
  const way = spec.higherIsBetter ? '≥' : '≤'
  const unit = unitOf(key)
  return `${way} ${spec.good}${unit} 算好，${way} ${spec.fair}${unit} 算一般`
}
