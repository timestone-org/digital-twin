/**
 * @fileoverview 模型页的展示口径：状态与可靠性的文案、数值格式化、行映射。
 *
 * ⚠ `failed` 行上可能带着上一次成功的评估（重训失败保留上一份产物），
 * 所以「失败」与「有指标」可以同时成立，映射时不许互斥。
 */
import type {
  AcModel,
  AcModelStatus,
  DtIntent,
  ModelMetricsBlock,
  ModelReliability,
} from '@dt/contracts'

import { formatDateTime } from '@/utils/datetime'

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

/** 训练中或排队中：列表页据此决定要不要轮询。 */
export function isModelBusy(model: AcModel): boolean {
  return model.status === 'queued' || model.status === 'training'
}

export interface ModelRow {
  id: string
  name: string
  room: string
  workshop: string
  status: AcModelStatus
  statusLabel: string
  statusIntent: DtIntent
  /** 失败原因或过期提示，占同一格：一次只说最要紧的一件事。 */
  notice: string | null
  sample: string
  mae: string
  coverage: string
  trained: string
  model: AcModel
}

/** 模型 → 列表行。 */
export function toModelRows(models: readonly AcModel[]): ModelRow[] {
  return models.map((model) => {
    const status = MODEL_STATUS_VIEW[model.status]
    const overall = model.metrics?.overall ?? null
    return {
      id: model.id,
      name: model.name,
      room: model.room.name,
      workshop: model.workshop.name,
      status: model.status,
      statusLabel: status.label,
      statusIntent: status.intent,
      notice: noticeOf(model),
      sample: model.sample_count === null ? '—' : String(model.sample_count),
      mae: overall ? formatMinutes(overall.mae) : '—',
      coverage: overall ? formatCoverage(overall.coverage) : '—',
      trained: formatDateTime(model.trained_at),
      model,
    }
  })
}

/** 一行要说的那件最要紧的事：失败原因 > 数据已更新 > 特征口径已更新。 */
function noticeOf(model: AcModel): string | null {
  if (model.status === 'failed' && model.error !== null) return model.error
  if (model.is_batch_stale) return '数据已更新，可重训'
  if (model.is_feature_stale) return '特征口径已更新，建议重训'
  return null
}

/** 按组合分组的评估行。⚠ block 为 null = 没样本，不是零误差。 */
export interface SetMetricsRow {
  id: string
  set: string
  count: string
  mae: string
  coverage: string
  width: string
  reliabilityLabel: string
  reliabilityIntent: DtIntent
  hasSamples: boolean
}

/** 分组评估 → 表行，键序即行序。 */
export function toSetRows(
  bySet: Record<string, ModelMetricsBlock | null>,
): SetMetricsRow[] {
  return Object.entries(bySet).map(([key, block]) => {
    if (block === null) {
      return {
        id: key,
        set: key,
        count: '0',
        mae: '—',
        coverage: '—',
        width: '—',
        reliabilityLabel: '无样本',
        reliabilityIntent: 'neutral',
        hasSamples: false,
      }
    }
    const reliability = RELIABILITY_VIEW[block.reliability]
    return {
      id: key,
      set: key,
      count: String(block.count),
      mae: formatMinutes(block.mae),
      coverage: formatCoverage(block.coverage),
      width: formatMinutes(block.mean_width),
      reliabilityLabel: reliability.label,
      reliabilityIntent: reliability.intent,
      hasSamples: true,
    }
  })
}
