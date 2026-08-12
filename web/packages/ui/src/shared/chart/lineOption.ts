/**
 * @fileoverview 折线图 option 的组装：`axis` 分组分轴、断档留空、配色取自
 * `@dt/tokens` 的 CSS 变量（换肤时跟着变）。
 */
import { readToken } from '@dt/tokens'

import { axisGroups, toChartData, unitOfAxis } from './series'
import type { DtChartDatum, DtChartSeries } from './series'
import { createTooltipFormatter } from './tooltip'
import type { DtTooltipParam } from './tooltip'

// 系列配色按序取用、用完循环；取值全部来自 token，没有一处写死
const SERIES_COLOR_TOKENS = [
  '--accent-primary',
  '--state-success',
  '--state-warning',
  '--state-danger',
  '--accent-secondary',
  '--state-idle',
] as const

const AXIS_OFFSET_PX = 56 // 同侧第二条 Y 轴的外移量
const LINE_WIDTH_PX = 1.5
// 绘图区四边留白：左右各让出一条 Y 轴的刻度文字，下方让出时间轴
const GRID_INSET_PX = { left: 56, right: 56, top: 36, bottom: 28 }

interface ChartTheme {
  palette: string[]
  axis: string | undefined
  label: string | undefined
  split: string | undefined
  surface: string | undefined
  text: string | undefined
}

interface ChartLineStyle {
  color?: string | undefined
  width?: number | undefined
}

interface ChartAxis {
  type: 'time' | 'value'
  name?: string | undefined
  nameTextStyle?: { color?: string | undefined } | undefined
  position?: 'left' | 'right' | undefined
  offset?: number | undefined
  scale?: boolean | undefined
  axisLine: { show?: boolean | undefined; lineStyle: ChartLineStyle }
  axisLabel: { color?: string | undefined; hideOverlap?: boolean | undefined }
  splitLine: { show: boolean; lineStyle: ChartLineStyle }
}

interface ChartLineSeries {
  id: string
  name: string
  type: 'line'
  yAxisIndex: number
  showSymbol: boolean
  /** ⚠ 恒为 false：NULL 是数据断档不是 0，连起来会把一次缺失读成停机 + 开机。 */
  connectNulls: false
  lineStyle: ChartLineStyle
  data: DtChartDatum[]
}

export type DtChartOption = {
  // ⚠ 不写 `| undefined`：echarts 的 color 在 exactOptionalPropertyTypes 下
  // 不收 undefined，取不到 token 时这个键必须整个不出现
  color?: string[]
  grid: { left: number; right: number; top: number; bottom: number }
  legend: {
    type: 'scroll'
    top: number
    textStyle: { color?: string | undefined }
  }
  tooltip: {
    trigger: 'axis'
    backgroundColor?: string | undefined
    borderColor?: string | undefined
    textStyle: { color?: string | undefined }
    formatter: (params: readonly DtTooltipParam[]) => HTMLElement
  }
  xAxis: ChartAxis
  yAxis: ChartAxis[]
  series: ChartLineSeries[]
}

/** 变量缺席（样式表还没挂上）时不给取值，让 echarts 用自己的默认。 */
function tokenColor(name: string): string | undefined {
  const value = readToken(name, '')
  return value === '' ? undefined : value
}

function chartTheme(): ChartTheme {
  return {
    palette: SERIES_COLOR_TOKENS.map(tokenColor).filter(
      (color) => color !== undefined,
    ),
    axis: tokenColor('--border-default'),
    label: tokenColor('--text-secondary'),
    split: tokenColor('--border-subtle'),
    surface: tokenColor('--surface-overlay'),
    text: tokenColor('--text-primary'),
  }
}

/**
 * 每个分组一条 Y 轴：偶数条挂左、奇数条挂右，同侧第二条起往外让。
 * @param series 全部系列
 * @param theme 取自 token 的配色
 */
function buildYAxes(
  series: readonly DtChartSeries[],
  theme: ChartTheme,
): ChartAxis[] {
  return axisGroups(series).map((axis, index) => ({
    type: 'value' as const,
    name: unitOfAxis(series, axis),
    nameTextStyle: { color: theme.label },
    position: index % 2 === 0 ? ('left' as const) : ('right' as const),
    offset: Math.floor(index / 2) * AXIS_OFFSET_PX,
    // 不强行把 0 纳进量程：室温这类量全挤在顶端就看不出波动了
    scale: true,
    axisLine: { show: true, lineStyle: { color: theme.axis } },
    axisLabel: { color: theme.label },
    splitLine: { show: index === 0, lineStyle: { color: theme.split } },
  }))
}

function buildSeries(
  series: readonly DtChartSeries[],
  groups: readonly string[],
): ChartLineSeries[] {
  return series.map((item) => ({
    id: item.key,
    name: item.name,
    type: 'line' as const,
    yAxisIndex: Math.max(groups.indexOf(item.axis), 0),
    showSymbol: false,
    connectNulls: false as const,
    lineStyle: { width: LINE_WIDTH_PX },
    data: toChartData(item.points),
  }))
}

/**
 * 组装整份 option。
 * @param series 全部系列，顺序即图例顺序
 */
export function buildLineOption(
  series: readonly DtChartSeries[],
): DtChartOption {
  const theme = chartTheme()
  const groups = axisGroups(series)
  return {
    ...(theme.palette.length > 0 ? { color: theme.palette } : {}),
    grid: GRID_INSET_PX,
    legend: { type: 'scroll', top: 0, textStyle: { color: theme.label } },
    tooltip: {
      trigger: 'axis',
      backgroundColor: theme.surface,
      borderColor: theme.axis,
      textStyle: { color: theme.text },
      formatter: createTooltipFormatter(series),
    },
    xAxis: {
      type: 'time',
      axisLine: { lineStyle: { color: theme.axis } },
      axisLabel: { color: theme.label, hideOverlap: true },
      splitLine: { show: false, lineStyle: { color: theme.split } },
    },
    yAxis: buildYAxes(series, theme),
    series: buildSeries(series, groups),
  }
}
