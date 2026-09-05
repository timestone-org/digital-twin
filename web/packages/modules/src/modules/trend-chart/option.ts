/**
 * @fileoverview trend-chart 的 option：把 `SeriesView[]` 铺成一组折线、一根时间轴、
 * 一到两根值轴、一条图例与一个提示框，外加参考线与缩放条。颜色只从主题与已解析的
 * `var(--…)` 来，取不到就省掉那个键、交回 echarts 默认。
 *
 * ⚠ 逐条状态只有**图例**这一个承载面：`graphic` 组件没有注册（写了静默不渲染），
 * 而模块标题条走 `ModulePanel`。折线族的图例名就是 `series.name`，所以没数的那几条
 * **照常进 option**、`data` 给空数组——series 自己带着名字，图例认得出。
 * ⚠ 时间刻度的格式化写在这里而不是 `.vue` 里：组件里禁 `new Date(` 与
 * `toLocaleString(`，那道闸只扫 `.vue`。
 * ⚠ 参考线只能挂在**某一条** series 上，它跟着那条 series 的 `yAxisIndex` 走。
 * 开了双轴还随手挂在第一条上，线就画在另一个量纲上了，且没有任何报错。
 * ⚠ 提示框的函数 formatter 返回值被 echarts 原样 `innerHTML`，拼进去的系列名与单位
 * 全是编辑器里的自由输入，一律过 `escapeHtml()`；反过来 series 的标签走 canvas，
 * 不解析 HTML 实体，转义了只会把 `&` 显示成 `&amp;`。
 */
import {
  animationOpts,
  areaFade,
  bottomBand,
  cartesianGrid,
  dataZoomSlider,
  escapeHtml,
  legendStyle,
  linearGradient,
  markLineRef,
  resolvePalette,
  tooltipStyle,
  TRANSPARENT_BG,
  valueAxis,
  valueText,
  type BottomBand,
  type ColorResolver,
  type MarkLineRef,
  type OptionFragment,
} from '../../shared/chart/chartKit'
import type { ECOption } from '../../shared/chart/echarts'
import {
  resolveColor,
  seriesColor,
  withColor,
  type ChartTheme,
} from '../../shared/chart/theme'
import {
  readArray,
  readBoolean,
  readEnum,
  readLooseNumber,
  readNumber,
  readRecord,
  readText,
  readTrimmedText,
} from '../../shared/config'
import {
  AREA_STYLES,
  SPAN_DAY_MS,
  SPAN_SECOND_LIMIT_MS,
  SPAN_YEAR_MS,
  TREND_AXIS_GAP,
  TREND_LINE_TYPE_VALUES,
  TREND_LINE_WIDTH,
  TREND_STYLE_VALUES,
  type TrendStyle,
} from './options'
import { spanOf, type SeriesView } from './series'

/** 图例与刻度的字号，与 chartKit 各处缺省同值。 */
const LABEL_FONT_SIZE = 11

/** 提示框里名字与读数之间那个分隔。 */
const JOIN = '：'

/** 堆叠面积共用的那一个堆名。 */
const STACK_NAME = 'trend'

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

/** 年月日，本地时。 */
function dayText(at: Date): string {
  return `${String(at.getFullYear())}-${pad2(at.getMonth() + 1)}-${pad2(at.getDate())}`
}

/** 时分，本地时。 */
function clockText(at: Date, seconds: boolean): string {
  const base = `${pad2(at.getHours())}:${pad2(at.getMinutes())}`
  return seconds ? `${base}:${pad2(at.getSeconds())}` : base
}

/**
 * 时间轴刻度的写法，按曲线的实际跨度分三档。
 * ⚠ 跨度是取回来的点算的：窗口住在每条绑定上，模块读不到；而同一块图里两条系列
 * 的窗口还允许不一样，刻度要能同时容下它们。
 * ⚠ 一律本地时：点位与台账两侧回的都是 UTC 毫秒，读的人在现场，按 UTC 打刻度会
 * 让整条曲线整体偏八小时，而每一个数都是对的。
 * @param span 全部曲线一起铺出来的跨度，毫秒
 */
export function tickFormatter(span: number): (value: number) => string {
  return (value: number) => {
    const at = new Date(value)
    if (span < SPAN_SECOND_LIMIT_MS) return clockText(at, true)
    if (span < SPAN_DAY_MS) return clockText(at, false)
    if (span < SPAN_YEAR_MS) {
      return `${pad2(at.getMonth() + 1)}-${pad2(at.getDate())} ${clockText(at, false)}`
    }
    return dayText(at)
  }
}

/** 提示框抬头那一行：一律精确到秒，不随跨度缩写。 */
function stampText(value: number): string {
  const at = new Date(value)
  return `${dayText(at)} ${clockText(at, true)}`
}

/**
 * 轴名，留空就整个键都不写。
 * ⚠ `exactOptionalPropertyTypes` 下显式写 `name: undefined` 是类型错，不是「没名字」。
 * @param raw 配置里那个轴名
 */
function axisName(raw: unknown): { name?: string } {
  const text = readTrimmedText(raw)
  return text === '' ? {} : { name: text }
}

/** echarts 回调参数里我们只用这两个下标，收窄成它免得把整包 params 摊进类型。 */
function seriesIndexOf(params: unknown): number {
  return readNumber(readRecord(params).seriesIndex, -1)
}

/**
 * 这一条画什么颜色：逐条固定色优先，其次按**文档序**取色板。
 * ⚠ 按文档序而不是按「第几条画得出来」取色：否则前面一条一断线，后面每一条的
 * 颜色都跟着挪一格，屏上看着像换了一套配色。
 * @param view 这一条
 * @param palette 已解析的色板
 * @param resolve 变量名 → 实际色值
 */
function colorOf(
  view: SeriesView,
  palette: readonly string[],
  resolve: ColorResolver,
): string {
  return resolveColor(view.color, resolve) || seriesColor(palette, view.index)
}

/** 一条系列的点摊成 echarts 时间轴要的 `[时刻, 值]` 对。 */
function pairsOf(view: SeriesView): [number, number][] {
  return view.points.map((point) => [point.t, point.v])
}

/**
 * 面积填充。
 * ⚠ 只有带面积的那两档才给，其余档一律省掉整个键：`areaStyle: {}` 在 echarts
 * 眼里是「要填充、用默认色」，折线图会平白多出一块半透明的底。
 * @param config 该节点落库的配置
 * @param color 这一条已解析的主色
 * @param resolve 变量名 → 实际色值
 * @param style 画法档
 */
function areaStyleOf(
  config: Record<string, unknown>,
  color: string,
  resolve: ColorResolver,
  style: TrendStyle,
): OptionFragment | undefined {
  if (!AREA_STYLES.includes(style)) return undefined
  const opacity = readNumber(config.areaOpacity, 0.18)
  if (!readBoolean(config.areaGradient, false)) {
    return { ...withColor(color), opacity }
  }
  const to = resolveColor(readText(config.areaGradientTo), resolve)
  const fade =
    to === ''
      ? areaFade(color, readNumber(config.areaTopAlpha, 0.3))
      : linearGradient([
          [0, color],
          [1, to],
        ])
  return fade === undefined
    ? { ...withColor(color), opacity }
    : { color: fade, opacity }
}

/** 这一帧的画法与取色，逐条 series 共用一份。 */
interface TrendLayout {
  style: TrendStyle
  theme: ChartTheme
  dualAxis: boolean
  /** 变量名 → 实际色值，逐条取色与面积渐变共用同一份。 */
  resolve: ColorResolver
  colorOf: (view: SeriesView) => string
}

/**
 * 这一条挂在哪根值轴上。开了双轴才有第二根，没开时右轴那一档静默等同左轴。
 * @param view 这一条
 * @param dualAxis 双轴开着没有
 */
function axisIndexOf(view: SeriesView, dualAxis: boolean): number {
  return dualAxis && view.axis === 'right' ? 1 : 0
}

/**
 * 一条折线。
 * ⚠ 没画出来的那几条也照常进 option、`data` 给空数组：折线族的图例认的是
 * `series.name`，series 不进 option 那一条图例连图元都不建，那一整档状态因此
 * 静默消失，而 dev 下只有一句 warn。
 * @param config 该节点落库的配置
 * @param view 这一条
 * @param layout 这一帧的画法与取色
 */
function lineSeries(
  config: Record<string, unknown>,
  view: SeriesView,
  layout: TrendLayout,
): OptionFragment {
  const color = layout.colorOf(view)
  const drawable = view.state === 'ok'
  const area = areaStyleOf(config, color, layout.resolve, layout.style)
  return {
    type: 'line',
    name: view.legendName,
    yAxisIndex: axisIndexOf(view, layout.dualAxis),
    data: drawable ? pairsOf(view) : [],
    smooth: layout.style === 'smooth',
    ...(layout.style === 'step' ? { step: 'end' } : {}),
    ...(layout.style === 'stackedArea' ? { stack: STACK_NAME } : {}),
    ...(area === undefined ? {} : { areaStyle: area }),
    // ⚠ 缺口就是缺口：连起来会把「这段时间没采到数」画成一条平滑过渡的假线
    connectNulls: false,
    showSymbol: readBoolean(config.showSymbol, true),
    symbolSize: readNumber(config.symbolSize, 6),
    lineStyle: {
      type: view.lineType,
      width: TREND_LINE_WIDTH,
      ...withColor(color),
    },
    itemStyle: { ...withColor(color) },
    label: readBoolean(config.showValueLabel, false)
      ? {
          show: true,
          position: 'top',
          fontSize: LABEL_FONT_SIZE,
          ...withColor(layout.theme.textMuted),
          formatter: labelFormatter(view),
        }
      : { show: false },
  }
}

/** 数据标签：只写这一条自己口径下的读数，名字已经在图例上了。 */
function labelFormatter(view: SeriesView): (params: unknown) => string {
  return (params: unknown) => {
    const raw = readArray(readRecord(params).value)[1]
    return typeof raw === 'number'
      ? valueText(raw, view.precision, view.unit)
      : ''
  }
}

/**
 * 时间轴。
 * ⚠ 是 `type: 'time'` 而不是类目轴：类目轴按点的**序号**等距铺，采样一疏一密的
 * 两段会被拉成一样宽，而两条窗口不同的系列压根对不齐。
 * @param config 该节点落库的配置
 * @param theme 当前主题色
 * @param span 全部曲线一起铺出来的跨度，毫秒
 */
function timeAxis(
  config: Record<string, unknown>,
  theme: ChartTheme,
  span: number,
): OptionFragment {
  const gap = readBoolean(config.boundaryGap, false)
  return {
    type: 'time',
    ...axisName(config.xAxisName),
    // 非类目轴的两端留白收的是一对百分比串，收布尔会被静默忽略
    boundaryGap: gap ? [TREND_AXIS_GAP, TREND_AXIS_GAP] : [0, 0],
    axisLabel: {
      fontSize: LABEL_FONT_SIZE,
      ...withColor(theme.textMuted),
      formatter: tickFormatter(span),
    },
    axisLine: { lineStyle: { ...withColor(theme.axisLine) } },
    axisTick: { show: false },
    splitLine: { show: false },
    nameTextStyle: {
      fontSize: LABEL_FONT_SIZE,
      ...withColor(theme.textMuted),
    },
  }
}

/**
 * 一到两根值轴。
 * ⚠ 刻度上**不写单位**：双轴时两根轴的量纲不一样，把整块那一个单位贴到两根轴上
 * 就是给右轴标了一个错的单位。单位在轴名与提示框里说。
 * @param config 该节点落库的配置
 * @param theme 当前主题色
 * @param dualAxis 双轴开着没有
 */
function valueAxes(
  config: Record<string, unknown>,
  theme: ChartTheme,
  dualAxis: boolean,
): OptionFragment[] {
  const precision = readNumber(config.precision, 2)
  const shared = {
    scale: readBoolean(config.yScale, true),
    labelFontSize: LABEL_FONT_SIZE,
    nameFontSize: LABEL_FONT_SIZE,
    axisLabelFormatter: (value: number) => valueText(value, precision),
  }
  const left = valueAxis(theme, { ...shared, ...axisName(config.yAxisName) })
  if (!dualAxis) return [left]
  return [
    left,
    valueAxis(theme, {
      ...shared,
      ...axisName(config.rightAxisName),
      // 右轴自己不再画一遍分隔线：两套横线叠在一起，网格会变成双份
      splitLine: false,
    }),
  ]
}

/**
 * 图例逐条的名字与配色。
 * ⚠ 每个名字都必须与某条 series 的 `name` 逐字相同，否则那一条图例不会被创建。
 * ⚠ `error` 那一档的文字取 `textMuted` 置灰——图例是这一档唯一能说话的地方。
 * @param views 这一块的全部系列
 * @param theme 当前主题色
 * @param colorer 这一条的取色
 */
function legendData(
  views: readonly SeriesView[],
  theme: ChartTheme,
  colorer: (view: SeriesView) => string,
): OptionFragment[] {
  return views.map((view) => ({
    name: view.legendName,
    textStyle: {
      ...withColor(view.state === 'error' ? theme.textMuted : theme.text),
    },
    itemStyle: {
      ...withColor(view.state === 'ok' ? colorer(view) : theme.textMuted),
    },
  }))
}

/**
 * 配置里的参考线。
 * @param config 该节点落库的配置
 * @param resolve 变量名 → 实际色值
 */
function refLinesOf(
  config: Record<string, unknown>,
  resolve: ColorResolver,
): MarkLineRef[] {
  const found: MarkLineRef[] = []
  for (const raw of readArray(config.refLines)) {
    const row = readRecord(raw)
    const value = readLooseNumber(row.value)
    if (value === null) continue
    const color = resolveColor(readTrimmedText(row.color), resolve)
    const size = readLooseNumber(row.fontSize)
    found.push({
      value,
      label: readTrimmedText(row.label),
      ...(color === '' ? {} : { color }),
      lineType: readEnum(row.lineType, TREND_LINE_TYPE_VALUES, 'dashed'),
      ...(size === null ? {} : { fontSize: size }),
    })
  }
  return found
}

/**
 * 参考线挂在哪一条 series 上。
 * ⚠ markLine 跟着它所在 series 的 `yAxisIndex` 走：开了双轴还随手挂在第一条上，
 * 参考值会按另一根轴的量纲落位——线画出来了，位置是错的，且零报错。挂在**左轴**
 * 第一条上；一条左轴系列都没有时才退到第一条（那时右轴就是这块图唯一的量纲）。
 * @param views 这一块的全部系列
 * @param dualAxis 双轴开着没有
 */
export function markLineCarrier(
  views: readonly SeriesView[],
  dualAxis: boolean,
): number {
  const left = views.findIndex(
    (view) => axisIndexOf(view, dualAxis) === 0 && view.state === 'ok',
  )
  if (left >= 0) return left
  const drawn = views.findIndex((view) => view.state === 'ok')
  return drawn >= 0 ? drawn : -1
}

/**
 * 提示框：同一时刻上把各条的读数排在一起，逐条用它自己的单位与小数位。
 * ⚠ 返回值被原样 innerHTML，逐段转义。
 * @param views 这一块的全部系列
 */
function tooltipFormatter(
  views: readonly SeriesView[],
): (params: unknown) => string {
  return (params: unknown) => {
    const rows = readArray(params)
    const first = readRecord(rows[0])
    const stamp = readArray(first.value)[0]
    const head = typeof stamp === 'number' ? stampText(stamp) : ''
    const lines = rows.map((row) => {
      const view = views[seriesIndexOf(row)]
      const raw = readArray(readRecord(row).value)[1]
      if (view === undefined || typeof raw !== 'number') return ''
      const text = valueText(raw, view.precision, view.unit)
      return `${escapeHtml(view.legendName)}${JOIN}${escapeHtml(text)}`
    })
    return [escapeHtml(head), ...lines.filter((line) => line !== '')].join(
      '<br/>',
    )
  }
}

/**
 * 点某一条线时上抛的联动值：这一条配置里写的名称，没起名就不上抛。
 * ⚠ 不上抛图例名：重名的那几条图例名带 `#1` 后缀、没起名的是「第 N 条」，
 * 前者没人猜得到，后者在上面插一条就整体挪位——配好的联动规则会静默失配。
 * @param views 这一块的全部系列
 * @param params echarts 的图元点击回调参数
 */
export function pickedSeriesValue(
  views: readonly SeriesView[],
  params: unknown,
): string {
  return views[seriesIndexOf(params)]?.emitValue ?? ''
}

/** 全部 series，参考线只挂在其中一条上。 */
function trendSeries(
  config: Record<string, unknown>,
  views: readonly SeriesView[],
  layout: TrendLayout,
): OptionFragment[] {
  const refs = refLinesOf(config, layout.resolve)
  const carrier =
    refs.length === 0 ? -1 : markLineCarrier(views, layout.dualAxis)
  return views.map((view, index) => {
    const base = lineSeries(config, view, layout)
    return index === carrier
      ? { ...base, markLine: markLineRef(layout.theme, refs) }
      : base
  })
}

/**
 * 绘图区的边距。刻度文字与轴名收在留白之内那一档由 `cartesianGrid` 缺省给出。
 * ⚠ 开了缩放条时底部让出来的高度由 `bottomBand` 一处算：图例与滑块都锚在画布底，
 * 各让各的会让选窗条横穿图例的字。
 * @param showLegend 图例开着没有
 * @param showZoom 缩放条开着没有
 * @param band 底部那条带子里各自的位置
 */
function gridOf(
  showLegend: boolean,
  showZoom: boolean,
  band: BottomBand,
): OptionFragment {
  return cartesianGrid({
    legend: showLegend,
    ...(showZoom ? { bottom: band.grid } : {}),
  })
}

/** 提示框，关着时只留一个 `show: false`。 */
function tooltipOf(
  config: Record<string, unknown>,
  views: readonly SeriesView[],
  theme: ChartTheme,
): OptionFragment {
  if (!readBoolean(config.showTooltip, true)) return { show: false }
  return {
    trigger: 'axis',
    ...tooltipStyle(theme),
    formatter: tooltipFormatter(views),
  }
}

/** 图例，关着时只留一个 `show: false`。 */
function legendOf(
  views: readonly SeriesView[],
  layout: TrendLayout,
  showLegend: boolean,
): OptionFragment {
  if (!showLegend) return { show: false }
  return legendStyle(layout.theme, {
    data: legendData(views, layout.theme, layout.colorOf),
    fontSize: LABEL_FONT_SIZE,
  })
}

/**
 * 一整块的 option。
 * @param config 该节点落库的配置
 * @param views 这一块的全部系列
 * @param theme 当前主题色
 * @param resolve 变量名 → 实际色值
 */
export function buildTrendOption(
  config: Record<string, unknown>,
  views: readonly SeriesView[],
  theme: ChartTheme,
  resolve: ColorResolver,
): ECOption {
  const palette = resolvePalette(config, theme, resolve)
  const showLegend = readBoolean(config.showLegend, true)
  const showZoom = readBoolean(config.showDataZoom, false)
  const dualAxis = readBoolean(config.dualAxis, false)
  const band = bottomBand({
    legend: showLegend,
    legendFontSize: LABEL_FONT_SIZE,
  })
  const layout: TrendLayout = {
    style: readEnum(config.chartStyle, TREND_STYLE_VALUES, 'line'),
    theme,
    dualAxis,
    resolve,
    colorOf: (view: SeriesView) => colorOf(view, palette, resolve),
  }
  return {
    ...TRANSPARENT_BG,
    ...animationOpts(config),
    grid: gridOf(showLegend, showZoom, band),
    tooltip: tooltipOf(config, views, theme),
    legend: legendOf(views, layout, showLegend),
    xAxis: timeAxis(config, theme, spanOf(views)),
    yAxis: valueAxes(config, theme, dualAxis),
    ...(showZoom
      ? {
          dataZoom: dataZoomSlider(theme, { xAxisIndex: 0, bottom: band.zoom }),
        }
      : {}),
    series: trendSeries(config, views, layout),
  }
}
