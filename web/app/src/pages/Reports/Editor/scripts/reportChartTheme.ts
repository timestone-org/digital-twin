/**
 * @fileoverview 报告图表的印刷配色与 ECharts 选项，与 Word 原生图表同一口径。
 * 后端副本 `apps/report/services/chart_theme.py`，由契约用例逐字比对。
 */
import type { EChartsOption } from 'echarts'
import type { ReportSchemas } from '@dt/contracts'

type NodeValue = ReportSchemas['NodeValue']

export const REPORT_SERIES_COLORS = [
  '#35618D',
  '#25847D',
  '#B77936',
  '#805EA0',
  '#B5485A',
  '#4F8FBF',
  '#7A8B3D',
  '#8C6D5A',
] as const
/** Word 里图表固定高 2 800 000 EMU。 */
export const REPORT_CHART_HEIGHT_CM = 7.78
export const REPORT_PRINT_COLORS = { text: '#595959', grid: '#D9D9D9' }

export interface ChartColors {
  text: string
  grid: string
}

export interface ChartFrame {
  categories: string[]
  series: { name: string; values: (number | null)[] }[]
}

/**
 * 图例只在多序列或饼图时出现，与 Word 一致。
 * @param node 试算回执里的图表
 */
export function hasLegend(node: NodeValue): boolean {
  return node.kind === 'pie' || (node.series?.length ?? 0) > 1
}

function numberOf(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

/**
 * 取出对齐好的类目与取值；缺类目的旧回执按时刻退化。
 * @param node 试算回执里的图表
 */
export function chartFrame(node: NodeValue): ChartFrame {
  const series = node.series ?? []
  if (node.categories?.length) {
    return {
      categories: node.categories,
      series: series.map((item) => ({
        name: item.name,
        values: (item.values ?? []).map(numberOf),
      })),
    }
  }
  const stamps = [
    ...new Set(series.flatMap((item) => item.points.map((point) => point.ts))),
  ].sort()
  return {
    categories: stamps,
    series: series.map((item) => {
      const byStamp = new Map(
        item.points.map((point) => [point.ts, numberOf(point.value)]),
      )
      return {
        name: item.name,
        values: stamps.map((stamp) => byStamp.get(stamp) ?? null),
      }
    }),
  }
}

/**
 * 图表里是否至少有一个可画的数。
 * @param node 试算回执里的图表
 */
export function hasChartData(node: NodeValue): boolean {
  return chartFrame(node).series.some((item) =>
    item.values.some((value) => value !== null),
  )
}

function pieOption(frame: ChartFrame, colors: ChartColors): EChartsOption {
  const first = frame.series[0]
  return {
    series: [
      {
        type: 'pie',
        name: first?.name ?? '',
        radius: '65%',
        center: ['50%', '45%'],
        label: { formatter: '{d}%', color: colors.text },
        data: frame.categories.flatMap((name, index) => {
          const value = first?.values[index] ?? null
          return value === null || value <= 0 ? [] : [{ name, value }]
        }),
      },
    ],
  }
}

function axisOption(
  node: NodeValue,
  frame: ChartFrame,
  colors: ChartColors,
): EChartsOption {
  const line = { lineStyle: { color: colors.grid } }
  return {
    grid: { left: 8, right: 16, top: 16, bottom: 8, containLabel: true },
    xAxis: {
      type: 'category',
      data: frame.categories,
      axisLabel: { color: colors.text, hideOverlap: true },
      axisLine: line,
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      scale: node.kind !== 'bar',
      axisLabel: { color: colors.text },
      axisLine: { show: true, ...line },
      splitLine: line,
    },
    series: frame.series.map((item) => ({
      name: item.name,
      type: node.kind === 'bar' ? 'bar' : 'line',
      data: item.values,
      connectNulls: false,
      showSymbol: false,
      lineStyle: { width: 2 },
    })),
  }
}

/**
 * 正文与核对区共用的 ECharts 选项。
 * @param node 试算回执里的图表
 * @param colors 文字与网格颜色；正文纸面用印刷色
 */
export function reportChartOption(
  node: NodeValue,
  colors: ChartColors,
): EChartsOption {
  const frame = chartFrame(node)
  const legend = hasLegend(node)
  const body =
    node.kind === 'pie'
      ? pieOption(frame, colors)
      : axisOption(node, frame, colors)
  return {
    backgroundColor: 'transparent',
    animation: false,
    color: [...REPORT_SERIES_COLORS],
    textStyle: { color: colors.text },
    tooltip: {
      trigger: node.kind === 'pie' ? 'item' : 'axis',
      renderMode: 'richText',
    },
    legend: {
      show: legend,
      type: 'scroll',
      bottom: 0,
      textStyle: { color: colors.text },
    },
    ...body,
    ...(legend && node.kind !== 'pie'
      ? {
          grid: { left: 8, right: 16, top: 16, bottom: 32, containLabel: true },
        }
      : {}),
  }
}
