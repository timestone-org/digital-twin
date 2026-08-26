/**
 * @fileoverview 趋势图的取值规则：哪些列画得出、勾选怎么变、取回来的序列怎么
 * 摊成 `DtChartSeries`，以及截断该怎么说。纯函数，与 Vue 无关。
 *
 * ⚠ 「勾了但这一次没取过数」的那几条**不进图**：勾选是即时的、取数不是，把
 * 刚勾上的列直接画进去只会得到一条有图例、没有线的空曲线，看的人会判成
 * 「这一列没数据」而不是「我还得再点一次查询」。
 */
import type {
  DatasetColumn,
  DatasetSeriesPoint,
  HistoryPoint,
} from '@dt/contracts'
import type { DtChartPoint, DtChartSeries } from '@dt/ui'

/** 一次最多画几条：再多就分不清颜色，也读不出交叉。 */
export const MAX_TREND_SERIES = 8

/** 进面板时先勾上几条，免得一进来是一张空图。 */
export const SEEDED_TREND_SERIES = 3

/** 被砍掉的是哪一头。 */
export type TrendCutEnd = 'earlier' | 'later'

/** 勾选清单里的一项。 */
export interface TrendItem {
  key: string
  label: string
  /** 量纲，同量纲共用一条 Y 轴。 */
  unit: string
  /**
   * 这一项到底画不画得出线。
   * ⚠ 画不出的照样列在清单里、也勾得上——藏起来的话，用户会在采集面看见这个
   * 点位、在这里找不到它，然后去查是不是权限出了问题。它只是默认被筛掉。
   */
  isDrawable: boolean
}

/**
 * 只有数值列画得出曲线。
 * @param columns 台账的全部列
 */
export function numericTrendColumns(
  columns: readonly DatasetColumn[],
): DatasetColumn[] {
  return columns.filter((column) => column.data_type === 'number')
}

/**
 * 把数值列摊成勾选项。
 * @param columns 数值列
 */
export function columnTrendItems(
  columns: readonly DatasetColumn[],
): TrendItem[] {
  return columns.map((column) => ({
    key: column.key,
    label:
      column.unit === null ? column.name : `${column.name}（${column.unit}）`,
    unit: column.unit ?? '',
    isDrawable: true,
  }))
}

/**
 * 默认勾上的那几条：前几项。
 * @param items 全部勾选项
 */
export function seedTrendSelection(items: readonly TrendItem[]): string[] {
  return items.slice(0, SEEDED_TREND_SERIES).map((item) => item.key)
}

/**
 * 勾选一项时的下一份取值；到上限就不再加。
 * @param selected 当前已选
 * @param key 被点的那一项
 */
export function toggleTrendKey(
  selected: readonly string[],
  key: string,
): string[] {
  if (selected.includes(key)) return selected.filter((item) => item !== key)
  if (selected.length >= MAX_TREND_SERIES) return [...selected]
  return [...selected, key]
}

/**
 * 一个取值能不能画成点。
 * ⚠ 认不出来的取值画成 `null`（断档）而不是跳过：跳过会让缺口被连成一条直线。
 * @param value 后端给的原值
 */
function toChartValue(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

/**
 * 把台账序列摊成折线图的系列。
 * ⚠ 只摊 `fetched` 里真有的那几个 key：没取过数的列不画（见文件头）。
 * @param fetched 上一次查询取回来的序列
 * @param items 勾选项，用来取名字与量纲
 * @param selected 当前勾选
 */
export function datasetChartSeries(
  fetched: Readonly<Record<string, readonly DatasetSeriesPoint[]>>,
  items: readonly TrendItem[],
  selected: readonly string[],
): DtChartSeries[] {
  const found: DtChartSeries[] = []
  for (const item of items) {
    if (!selected.includes(item.key)) continue
    const points = fetched[item.key]
    if (points === undefined) continue
    found.push({
      key: item.key,
      name: item.label,
      unit: item.unit,
      axis: item.unit,
      points: points.map<DtChartPoint>((point) => [
        point.ts,
        toChartValue(point.value),
      ]),
    })
  }
  return found
}

/**
 * 把点位历史摊成折线图的系列。
 * @param fetched 上一次查询取回来的读数，按点位身份归档
 * @param items 勾选项
 * @param selected 当前勾选
 */
export function pointChartSeries(
  fetched: Readonly<Record<string, readonly HistoryPoint[]>>,
  items: readonly TrendItem[],
  selected: readonly string[],
): DtChartSeries[] {
  const found: DtChartSeries[] = []
  for (const item of items) {
    if (!selected.includes(item.key)) continue
    const points = fetched[item.key]
    if (points === undefined) continue
    found.push({
      key: item.key,
      name: item.label,
      unit: item.unit,
      axis: item.unit,
      points: points.map<DtChartPoint>((point) => [
        new Date(point.t).toISOString(),
        toChartValue(point.v),
      ]),
    })
  }
  return found
}

/**
 * 勾选是否已经超出上一次查询的结果——超出就得提示重查。
 * @param hasQueried 这一面查过没有
 * @param selected 当前勾选
 * @param fetched 上一次查询取回来的那几个 key
 */
export function isSelectionDirty(
  hasQueried: boolean,
  selected: readonly string[],
  fetched: Readonly<Record<string, unknown>>,
): boolean {
  return hasQueried && selected.some((key) => !(key in fetched))
}

/**
 * 截断的那一句。
 * ⚠ 必须说清砍掉的是哪一头：曲线开头凭空少一截会被读成「采集那阵子坏了」，
 * 而它其实只是没画（docs/DATASET_DESIGN.md §6.2）。
 * @param cut 被砍掉的是更早还是更晚那一段
 * @param limit 后端这一次的上限
 */
export function truncationHint(cut: TrendCutEnd, limit: number): string {
  const kept = cut === 'earlier' ? '最近' : '最早'
  const dropped = cut === 'earlier' ? '更早' : '更晚'
  return (
    `这段时间的数据超过了 ${limit} 条上限，图上只画了${kept}的那一批；` +
    `${dropped}的那一段没有画出来，把时间范围缩小再查一次才看得到。`
  )
}

/**
 * 图上一共多少个点。
 * @param series 全部系列
 */
export function countTrendPoints(series: readonly DtChartSeries[]): number {
  return series.reduce((total, item) => total + item.points.length, 0)
}
