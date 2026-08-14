/**
 * @fileoverview 折线图的取值契约：一条系列 = 一个量的时序。
 * `axis` 是 Y 轴分组键，同键共用一条轴——组件不认识任何业务分组，
 * 分组由调用方按自己的指标目录给。
 */

/** 一个采样点。`null` 是断档，不是 0。 */
export type DtChartPoint = readonly [isoTs: string, value: number | null]

export interface DtChartSeries {
  /** 系列标识，落成 echarts 的实例内 id。 */
  key: string
  name: string
  /** 量纲，进 tooltip 与所属 Y 轴的轴名。 */
  unit: string
  /** Y 轴分组键。首次出现的顺序决定这条轴挂左还是挂右。 */
  axis: string
  points: readonly DtChartPoint[]
}

/** 画到画布上的一点：毫秒时间戳 + 取值。 */
export type DtChartDatum = readonly [epochMs: number, value: number | null]

/**
 * 把 RFC3339 时刻换算成毫秒时间戳；解析不出时刻的点直接丢弃。
 * @param points 一条系列的原始采样点
 */
export function toChartData(points: readonly DtChartPoint[]): DtChartDatum[] {
  const found: DtChartDatum[] = []
  for (const [isoTs, value] of points) {
    const epochMs = Date.parse(isoTs)
    if (!Number.isNaN(epochMs)) found.push([epochMs, value])
  }
  return found
}

/**
 * 各系列声明过的 Y 轴分组，按首次出现排序。
 * @param series 全部系列
 */
export function axisGroups(series: readonly DtChartSeries[]): string[] {
  const found: string[] = []
  for (const item of series) {
    if (!found.includes(item.axis)) found.push(item.axis)
  }
  return found
}

/**
 * 某个分组的量纲，取该组第一条系列的。
 * @param series 全部系列
 * @param axis 分组键
 */
export function unitOfAxis(
  series: readonly DtChartSeries[],
  axis: string,
): string {
  return series.find((item) => item.axis === axis)?.unit ?? ''
}
