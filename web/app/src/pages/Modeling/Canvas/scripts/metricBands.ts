/**
 * @fileoverview 指标好不好：把一个数折成三档色。
 *
 * ⚠ 分档必须**逐指标**定方向：R² 越大越好、MAPE 越小越好，用同一套阈值去套的话
 * 一个 5% 的 MAPE 会被染成「差」，而那其实是很好的结果。
 */
import type { DtIntent } from '@dt/contracts'

/** 三档观感。 */
export type MetricBand = 'good' | 'fair' | 'poor' | 'unknown'

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

/** 没有分档口径的那些（MAE / RMSE / 最大误差）——它们的好坏取决于量纲。 */
const PLAIN_LABELS: Record<string, string> = {
  mae: 'MAE',
  rmse: 'RMSE',
  max_error: '最大误差',
}

/** 指标的中文名。不认识的原样显示，不吞掉。 */
export function labelOf(key: string): string {
  return SPECS[key]?.label ?? PLAIN_LABELS[key] ?? key
}

/**
 * 这个数落在哪一档。
 *
 * ⚠ 没有分档口径的指标一律给 `unknown` 而不是 `fair`：MAE 是 3 好不好，只有
 * 知道那一列的量纲才答得上来，替用户拍一个颜色等于给一个没根据的结论。
 */
export function bandOf(key: string, value: number | null): MetricBand {
  const spec = SPECS[key]
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

/** 这个指标的单位；没有单位给空串。 */
export function unitOf(key: string): string {
  return UNITS[key] ?? ''
}

/** 有分档口径的指标，它的那句阈值说明；没有的给空串。 */
export function bandHintOf(key: string): string {
  const spec = SPECS[key]
  if (spec === undefined) return ''
  const way = spec.higherIsBetter ? '≥' : '≤'
  const unit = unitOf(key)
  return `${way} ${spec.good}${unit} 算好，${way} ${spec.fair}${unit} 算一般`
}
