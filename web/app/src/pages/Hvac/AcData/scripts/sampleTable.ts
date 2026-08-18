/**
 * @fileoverview 原始数据表格的列与行。
 *
 * ⚠ 列由**目录**生成，不在前端写死那 19 个键：目录加一个指标、或换一个数据集
 * 时，写死的列会静静少一列，而页面看着完全正常。插槽名与列名同源生成，
 * 所以「插槽名拼错」这种在本仓要靠契约测试兜的错，在这里结构上不可能发生。
 */
import type { AcMetric, DtDataColumn, RawSample } from '@dt/contracts'

import { formatDateTime } from '@/utils/datetime'

/** 断档的显示形态。⚠ 是破折号，不是 0——0 是一个真实读数。 */
const MISSING = '—'
// 传感器原值常带 float 噪声（22.399999618530273），显示到三位足够且不改语义
const DISPLAY_DIGITS = 3

export interface SampleColumn extends DtDataColumn {
  /**
   * 单元格插槽名，与 key 同源生成。
   * ⚠ 预先算好而不是在模板里拼：动态插槽名写在属性名位置，那里不能带反引号
   * （`DtDataView` 里那个 `cellSlot()` 是同一个理由）。
   */
  slot: `cell-${string}`
}

export interface SampleRow {
  id: string
  /** 列 key → 已经格式化好的显示串。模板里不再做计算。 */
  cells: Record<string, string>
}

/**
 * 时刻列 + 每个指标一列。
 * @param metrics 当前数据集的指标目录
 */
export function toSampleColumns(metrics: readonly AcMetric[]): SampleColumn[] {
  return [
    { key: 'ts', slot: 'cell-ts', label: '时刻', width: '12rem' },
    ...metrics.map((metric) => ({
      key: metric.key,
      slot: `cell-${metric.key}` as const,
      label:
        metric.unit === '' ? metric.name : `${metric.name}（${metric.unit}）`,
      width: '9rem',
      align: 'right' as const,
    })),
  ]
}

/**
 * 一个读数的显示形态。
 * @param value 取值，`null` / 缺席都表示这一刻没有采到
 */
export function formatReading(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return MISSING
  return String(Number(value.toFixed(DISPLAY_DIGITS)))
}

/**
 * 把一行采样摊成「列 key → 显示串」。
 * ⚠ 测点键随目录走，只能按 key 查；`ts` 先解构出去，免得混进读数。
 * @param sample 后端给的一行
 * @param metrics 当前数据集的指标目录
 */
export function toSampleRow(
  sample: RawSample,
  metrics: readonly AcMetric[],
): SampleRow {
  // ⚠ 解构把 `ts` 摘出去，剩下整块就是「键 → 读数」，可以按目录的 key 查；
  // 直接 Object.entries(sample) 拿到的值类型是 any，等于把类型检查关掉。
  const { ts, ...rest } = sample
  const readings: Record<string, number | null> = rest
  const cells: Record<string, string> = { ts: formatDateTime(ts) }
  for (const metric of metrics) {
    cells[metric.key] = formatReading(readings[metric.key])
  }
  return { id: ts, cells }
}
