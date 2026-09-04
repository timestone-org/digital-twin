/**
 * @fileoverview bar-chart 的 option：把 `BarChartView` 铺成一条类目轴、一到两条值轴、
 * 一组柱/折线系列、一条图例与一个提示框。颜色只从主题与已解析的 `var(--…)` 来，
 * 取不到就省掉那个键、交回 echarts 默认。
 *
 * ⚠ 逐行状态只有**图例**这一个承载面：`graphic` 组件没有注册（写了静默不渲染），
 * 而模块标题条走 `ModulePanel`。非 ok 的那几行因此照常进 `series`、`data` 给空数组，
 * 名字由 `series.name` 自己带着——图例只认「名字等于某个系列名」或「名字在该系列的
 * 原始 data 里」这两条，两条都不中的图例项连图元都不建，dev 下只打一句 warn。
 * ⚠ 百分比档的分母是取值层自己算的：`stack` 的百分比语义要靠没注册的 `dataset`
 * 组件，而且自己算才能让「一整列全缺」留空，不至于画成一排 0%。
 * ⚠ `line` 行绝不参与 `stack`：折线堆叠会把「达标率」加到「产量」上去，
 * 画出来的那条线不对应任何一个真实的量。
 * ⚠ 提示框的函数 formatter 返回值被 echarts 原样 `innerHTML`，拼进去的名字与单位
 * 全是编辑器里的自由输入，一律过 `escapeHtml()`；反过来 series 的标签走 canvas，
 * 不解析 HTML 实体，转义了只会把 `&` 显示成 `&amp;`。
 */
import {
  animationOpts,
  cartesianGrid,
  categoryAxis,
  dataZoomSlider,
  escapeHtml,
  legendStyle,
  linearGradient,
  markLineRef,
  resolvePalette,
  tooltipStyle,
  TRANSPARENT_BG,
  valueAxis,
  type ColorResolver,
  type MarkLineRef,
  type OptionFragment,
} from '../../shared/chart/chartKit'
import type { ECOption } from '../../shared/chart/echarts'
import {
  resolveColor,
  seriesColor,
  withAlpha,
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
import { NO_DATA } from '../../shared/format'
import {
  cellText,
  readBarFormat,
  shareText,
  type BarChartView,
  type BarFormat,
  type BarItem,
  type BarSeriesView,
} from './bars'
import {
  BAR_RADIUS_DEFAULT,
  BAR_RADIUS_MAX,
  BAR_RADIUS_MIN,
  BAR_STYLE_VALUES,
  BAR_WIDTH_MAX,
  BAR_WIDTH_MIN,
  type BarStyle,
} from './options'

/**
 * 实时档所有柱共用的内部堆名。
 * ⚠ 实时档一行就是一个类目，不共用一个堆位的话 N 行会在每个类目上各占一格，
 * 每根柱缩到 1/N 宽、还偏在自己那一格里——屏上像一排随机错位的细线。
 */
const LIVE_STACK = '__live__'

/** 堆叠档里没写分组名的那几行共用的堆名。 */
const DEFAULT_STACK = '__stacked__'

/** 百分比档的值轴量程固定 0–100。 */
const PERCENT_MAX = 100

/** 提示框里读数与占比之间那个分隔。 */
const JOIN = ' · '

/** 参考线线型的白名单，与 `markLineFields()` 的选项同一份。 */
const LINE_TYPES = ['solid', 'dashed', 'dotted'] as const

/** 值轴刻度只用整块那一份口径，不带任何一行自己的单位。 */
const AXIS_ITEM: BarItem = {
  name: '',
  unit: '',
  precision: null,
  color: '',
  stack: '',
  plot: 'bar',
  axis: 'left',
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}

/** 这一块的几何与取数口径，逐段构建时共用一份。 */
interface BarLayout {
  style: BarStyle
  /** 类目轴转到纵向。 */
  horizontal: boolean
  /** 百分比堆叠：画的是取值层算好的占比。 */
  percent: boolean
  /** 正负对称：值轴按最大绝对值向两侧铺开。 */
  diverging: boolean
  format: BarFormat
  /** 有没有一行挂在右轴上；没有就只出一条值轴。 */
  hasRight: boolean
  /** 渐变末端色，已解析；空串 = 由主色派生同色渐隐。 */
  gradientTo: string
  colorOf: (series: BarSeriesView) => string
}

/**
 * 这一行画什么颜色：逐行固定色优先，其次按**文档序**取色板。
 * ⚠ 按文档序而不是按「第几行画得出来」取色：否则前面一行一断线，后面每一行的
 * 颜色都跟着挪一格，屏上看着像换了一套配色。
 * @param series 这一行
 * @param palette 已解析的色板
 * @param resolve 变量名 → 实际色值
 */
function colorOf(
  series: BarSeriesView,
  palette: readonly string[],
  resolve: ColorResolver,
): string {
  return (
    resolveColor(series.item.color, resolve) ||
    seriesColor(palette, series.index)
  )
}

/** 这一行此刻画得出东西没有。非 ok 与空序列的 `data` 都是一格都没有。 */
function isDrawable(series: BarSeriesView): boolean {
  return series.data.some((value) => value !== null)
}

/**
 * 这一行归到哪个堆。
 * ⚠ 折线永远不堆；实时档一律共用一个堆位（见 `LIVE_STACK`）；
 * 并排档只有显式写了分组名的那几行才堆——「留空不堆叠」是面板上写着的语义。
 * @param series 这一行
 * @param view 这一块的取值结果
 * @param layout 几何与取数口径
 */
function stackOf(
  series: BarSeriesView,
  view: BarChartView,
  layout: BarLayout,
): string {
  if (series.item.plot === 'line') return ''
  if (view.source === 'live') return LIVE_STACK
  if (layout.style === 'stacked' || layout.percent) {
    return series.item.stack || DEFAULT_STACK
  }
  return series.item.stack
}

/**
 * 柱体填充：开了渐变就从主色派生「基部浓、末端透」的线性渐变。
 * ⚠ 方向跟着几何走：竖柱从底往上长，透的那一头在**上**；横条从左往右长，
 * 透的那一头在**右**。写反了会让柱根处发虚，看着像没画满。
 * ⚠ 主色是 `withAlpha` 解析不了的写法（`hsl()` / 命名色）时退回纯色：
 * 两端同色的「渐变」画出来就是一块实心，白白多一层 echarts 的渐变对象；
 * 而 chartKit 那边给折线面积用的「退回透明」放到柱上是柱顶被削掉一截。
 * @param color 已解析的主色
 * @param config 该节点落库的配置
 * @param layout 几何与取数口径
 */
function barFill(
  color: string,
  config: Record<string, unknown>,
  layout: BarLayout,
): OptionFragment | string {
  if (!readBoolean(config.barGradient, false) || color === '') return color
  const alpha = clamp(readNumber(config.barTopAlpha, 0.45), 0, 1)
  const derived = withAlpha(color, alpha)
  const faded = layout.gradientTo || derived
  if (faded === '' || faded === color) return color
  const stops: [number, string][] = layout.horizontal
    ? [
        [0, color],
        [1, faded],
      ]
    : [
        [0, faded],
        [1, color],
      ]
  return linearGradient(stops, layout.horizontal ? 'h' : 'v')
}

/**
 * 数值标签的文案。
 * ⚠ 逐行的单位与小数位优先：一块图里「产量 t」与「达标率 %」并排时，
 * 拿整块那一份口径去写标签会给百分比也加上吨。
 * @param series 这一行
 * @param layout 几何与取数口径
 */
function labelFormatter(
  series: BarSeriesView,
  layout: BarLayout,
): (params: { value: unknown }) => string {
  return (params: { value: unknown }) => {
    const value = params.value
    if (typeof value !== 'number' || !Number.isFinite(value)) return ''
    return layout.percent
      ? shareText(value)
      : cellText(value, series.item, layout.format)
  }
}

/**
 * 一行要画的那一列数；负值那几格连自己的标签位置一起带上。
 * ⚠ `label.position` 只认字符串、不认回调，所以负值的翻边只能逐个数据项写。
 * 不翻的话「-30」那个标签压在 0 线上方，与相邻那根正值柱的标签叠在一起。
 * @param series 这一行
 * @param layout 几何与取数口径
 * @param showLabel 数值标签开着没有
 */
function seriesData(
  series: BarSeriesView,
  layout: BarLayout,
  showLabel: boolean,
): unknown[] {
  const column = layout.percent ? series.shares : series.data
  const negative = layout.horizontal ? 'left' : 'bottom'
  return column.map((value) =>
    showLabel && value !== null && value < 0
      ? { value, label: { position: negative } }
      : value,
  )
}

/**
 * series 上的数值标签；关着时只留一个 `show: false`。
 * @param config 该节点落库的配置
 * @param theme 当前主题色
 * @param series 这一行
 * @param layout 几何与取数口径
 */
function seriesLabel(
  config: Record<string, unknown>,
  theme: ChartTheme,
  series: BarSeriesView,
  layout: BarLayout,
): OptionFragment {
  if (!readBoolean(config.showValueLabel, true)) return { show: false }
  return {
    show: true,
    position: layout.horizontal ? 'right' : 'top',
    fontSize: readNumber(config.labelFontSize, 11),
    ...withColor(readTrimmedText(config.labelColor) || theme.textMuted),
    formatter: labelFormatter(series, layout),
  }
}

/**
 * 参考线。
 * ⚠ 百分比档一律不画：阈值写的是原始单位（「产量 500 吨」），而画布上是占比，
 * 那条线会落在一个与任何东西都无关的高度上，且没有任何报错。
 * @param config 该节点落库的配置
 * @param theme 当前主题色
 * @param layout 几何与取数口径
 */
function refLinesOf(
  config: Record<string, unknown>,
  theme: ChartTheme,
  layout: BarLayout,
): OptionFragment | undefined {
  if (layout.percent) return undefined
  const refs: MarkLineRef[] = []
  for (const row of readArray(config.refLines)) {
    const item = readRecord(row)
    const value = readLooseNumber(item.value)
    if (value === null) continue
    const color = readTrimmedText(item.color)
    const size = readLooseNumber(item.fontSize)
    refs.push({
      value,
      label: readTrimmedText(item.label),
      ...(color === '' ? {} : { color }),
      lineType: readEnum(item.lineType, LINE_TYPES, 'dashed'),
      ...(size === null ? {} : { fontSize: size }),
      // 值轴在横向档是 x：参考线要绑到值那一根轴上，绑错就横竖倒置
      axis: layout.horizontal ? 'x' : 'y',
    })
  }
  return refs.length === 0 ? undefined : markLineRef(theme, refs)
}

/**
 * 参考线挂在哪一条系列上。
 * ⚠ 挂在每一条上会让同一条阈值线被画 N 遍，标签叠成一团黑；
 * 优先挑左轴的那一条——挂到右轴的系列上，参考值会按右轴的量程摆位置。
 * @param view 这一块的取值结果
 */
export function refHostIndex(view: BarChartView): number {
  const left = view.series.findIndex(
    (series) => isDrawable(series) && series.item.axis === 'left',
  )
  return left >= 0 ? left : view.series.findIndex(isDrawable)
}

/** 一条系列画完的样子。 */
interface SeriesContext {
  view: BarChartView
  layout: BarLayout
  markLine?: OptionFragment
}

/**
 * 一条系列。
 * @param config 该节点落库的配置
 * @param theme 当前主题色
 * @param series 这一行
 * @param ctx 取值结果、几何口径与要不要挂参考线
 */
function oneSeries(
  config: Record<string, unknown>,
  theme: ChartTheme,
  series: BarSeriesView,
  ctx: SeriesContext,
): OptionFragment {
  const line = series.item.plot === 'line'
  const color = ctx.layout.colorOf(series)
  const stack = stackOf(series, ctx.view, ctx.layout)
  const width = readLooseNumber(config.barWidth)
  const showLabel = readBoolean(config.showValueLabel, true)
  const axisIndex = series.item.axis === 'right' && ctx.layout.hasRight ? 1 : 0
  return {
    type: line ? 'line' : 'bar',
    name: series.legendName,
    data: seriesData(series, ctx.layout, showLabel),
    ...(stack === '' ? {} : { stack }),
    ...(ctx.layout.horizontal
      ? { xAxisIndex: axisIndex }
      : { yAxisIndex: axisIndex }),
    ...(line
      ? {
          smooth: true,
          symbolSize: 5,
          lineStyle: { ...withColor(color) },
          itemStyle: { ...withColor(color) },
        }
      : {
          ...(width === null
            ? {}
            : { barMaxWidth: clamp(width, BAR_WIDTH_MIN, BAR_WIDTH_MAX) }),
          itemStyle: {
            color: barFill(color, config, ctx.layout),
            borderRadius: clamp(
              readNumber(config.barRadius, BAR_RADIUS_DEFAULT),
              BAR_RADIUS_MIN,
              BAR_RADIUS_MAX,
            ),
            opacity: clamp(readNumber(config.barOpacity, 1), 0, 1),
          },
        }),
    label: seriesLabel(config, theme, series, ctx.layout),
    ...(ctx.markLine === undefined ? {} : { markLine: ctx.markLine }),
  }
}

/**
 * 图例逐条的名字与配色。
 * ⚠ 这一份的每个名字都得等于某条 `series.name`，否则那一条图例不会被创建。
 * ⚠ `error` 那一档的文字取 `textMuted` 置灰——图例是这一档唯一能说话的地方。
 * @param view 这一块的取值结果
 * @param theme 当前主题色
 * @param layout 几何与取数口径
 */
function legendData(
  view: BarChartView,
  theme: ChartTheme,
  layout: BarLayout,
): OptionFragment[] {
  return view.series.map((series) => ({
    name: series.legendName,
    textStyle: {
      ...withColor(series.state === 'error' ? theme.textMuted : theme.text),
    },
    itemStyle: {
      ...withColor(
        isDrawable(series) ? layout.colorOf(series) : theme.textMuted,
      ),
    },
  }))
}

/**
 * 提示框里的一行。⚠ 逐段转义：这整块返回值被 echarts 原样 `innerHTML`。
 * @param series 这一行
 * @param cell 落在哪一个类目上
 * @param layout 几何与取数口径
 */
function tooltipLine(
  series: BarSeriesView,
  cell: number,
  layout: BarLayout,
): string {
  // 缺格写「—」而不是留一行空白：那一格是「没采到」，不是「没有这一行」
  const text = cellText(series.data[cell] ?? null, series.item, layout.format)
  const share = layout.percent ? shareText(series.shares[cell] ?? null) : ''
  const tail = share === '' ? '' : `${JOIN}${escapeHtml(share)}`
  return `${escapeHtml(series.legendName)} ${escapeHtml(text || NO_DATA)}${tail}`
}

/**
 * 提示框的一整块 HTML。
 * @param view 这一块的取值结果
 * @param layout 几何与取数口径
 */
function tooltipFormatter(
  view: BarChartView,
  layout: BarLayout,
): (params: unknown) => string {
  return (params: unknown) => {
    const lines: string[] = []
    let head = ''
    for (const row of Array.isArray(params) ? params : [params]) {
      const entry = readRecord(row)
      const series = view.series[readNumber(entry.seriesIndex, -1)]
      if (series === undefined) continue
      head = escapeHtml(readText(entry.axisValueLabel))
      lines.push(tooltipLine(series, readNumber(entry.dataIndex, -1), layout))
    }
    if (lines.length === 0) return ''
    return head === '' ? lines.join('<br/>') : [head, ...lines].join('<br/>')
  }
}

/**
 * 点一根柱上抛的联动值：这一行配置里写的名称，没起名就不上抛。
 * ⚠ 不上抛图例名：重名的那几行带 `#1` 后缀、没起名的是「第 N 行」，
 * 前者没人猜得到，后者在上面插一行就整体挪位——配好的联动规则会静默失配。
 * @param view 这一块的取值结果
 * @param params echarts 的图元点击回调参数
 */
export function pickedBarValue(view: BarChartView, params: unknown): string {
  const at = readNumber(readRecord(params).seriesIndex, -1)
  return view.series[at]?.emitValue ?? ''
}

/**
 * 正负对称档的值轴量程：取最大绝对值向两侧铺开。
 * ⚠ 不对称的话，「回馈 20」与「用电 400」画在同一根轴上，回馈那一段只有一像素高，
 * 而「正负各占一半」正是这一档存在的理由。
 * @param view 这一块的取值结果
 */
export function symmetricBound(view: BarChartView): number | undefined {
  let top = 0
  for (const series of view.series) {
    for (const value of series.data) {
      if (value !== null) top = Math.max(top, Math.abs(value))
    }
  }
  return top > 0 ? top : undefined
}

/** 类目标签的抽稀间隔：留空自动，填 0 全显，填 n 每隔 n 个显示一个。 */
function labelInterval(config: Record<string, unknown>): number | 'auto' {
  const raw = readLooseNumber(config.xLabelInterval)
  return raw === null || raw < 0 ? 'auto' : Math.trunc(raw)
}

/** 值轴的刻度文案：百分比档写百分号，其余走整块的单位与小数位。 */
function axisTextOf(layout: BarLayout): (value: number) => string {
  return (value: number) =>
    layout.percent
      ? shareText(value)
      : cellText(value, AXIS_ITEM, layout.format)
}

/**
 * 一到两条值轴；只有真有行挂在右轴上时才出第二条。
 * @param config 该节点落库的配置
 * @param theme 当前主题色
 * @param view 这一块的取值结果
 * @param layout 几何与取数口径
 */
function valueAxes(
  config: Record<string, unknown>,
  theme: ChartTheme,
  view: BarChartView,
  layout: BarLayout,
): OptionFragment[] {
  const bound = layout.diverging ? symmetricBound(view) : undefined
  const shared = {
    labelFontSize: readNumber(config.axisLabelFontSize, 11),
    nameFontSize: readNumber(config.axisNameFontSize, 11),
    axisLabelFormatter: axisTextOf(layout),
    scale: readBoolean(config.yScale, false),
    ...(layout.percent ? { min: 0, max: PERCENT_MAX } : {}),
    ...(bound === undefined ? {} : { min: -bound, max: bound }),
  }
  const name = readTrimmedText(
    layout.horizontal ? config.xAxisName : config.yAxisName,
  )
  const axes = [valueAxis(theme, { ...shared, name })]
  // 右轴不再画一遍分隔线：两套刻度的横线交错在一起，图上像蒙了一层网格
  if (layout.hasRight) {
    axes.push(valueAxis(theme, { ...shared, splitLine: false }))
  }
  return axes
}

/**
 * 类目轴。横向档要 `inverse`，否则第一行画在最下面、与图例顺序相反。
 * @param config 该节点落库的配置
 * @param theme 当前主题色
 * @param view 这一块的取值结果
 * @param layout 几何与取数口径
 */
function catAxis(
  config: Record<string, unknown>,
  theme: ChartTheme,
  view: BarChartView,
  layout: BarLayout,
): OptionFragment {
  return categoryAxis(theme, view.categories, {
    name: readTrimmedText(
      layout.horizontal ? config.yAxisName : config.xAxisName,
    ),
    boundaryGap: readBoolean(config.boundaryGap, true),
    interval: labelInterval(config),
    labelFontSize: readNumber(config.axisLabelFontSize, 11),
    nameFontSize: readNumber(config.axisNameFontSize, 11),
    ...(layout.horizontal ? { inverse: true } : {}),
  })
}

/**
 * 这一帧的几何与取数口径。
 * @param config 该节点落库的配置
 * @param view 这一块的取值结果
 * @param theme 当前主题色
 * @param resolve 变量名 → 实际色值
 */
function layoutOf(
  config: Record<string, unknown>,
  view: BarChartView,
  theme: ChartTheme,
  resolve: ColorResolver,
): BarLayout {
  const style: BarStyle = readEnum(
    config.chartStyle,
    BAR_STYLE_VALUES,
    'grouped',
  )
  const palette = resolvePalette(config, theme, resolve)
  return {
    style,
    horizontal: style === 'horizontal',
    percent: style === 'percent',
    diverging: style === 'diverging',
    format: readBarFormat(config),
    hasRight: view.series.some((series) => series.item.axis === 'right'),
    gradientTo: resolveColor(readTrimmedText(config.barGradientTo), resolve),
    colorOf: (series) => colorOf(series, palette, resolve),
  }
}

/**
 * 提示框那一段；关着时只留一个 `show: false`，不留半份样式。
 * @param config 该节点落库的配置
 * @param theme 当前主题色
 * @param view 这一块的取值结果
 * @param layout 几何与取数口径
 */
function tooltipOf(
  config: Record<string, unknown>,
  theme: ChartTheme,
  view: BarChartView,
  layout: BarLayout,
): OptionFragment {
  if (!readBoolean(config.showTooltip, true)) return { show: false }
  return {
    trigger: 'axis',
    axisPointer: { type: 'shadow' },
    ...tooltipStyle(theme, {
      fontSize: readNumber(config.tooltipFontSize, 12),
    }),
    formatter: tooltipFormatter(view, layout),
  }
}

/**
 * 图例那一段。
 * @param config 该节点落库的配置
 * @param theme 当前主题色
 * @param view 这一块的取值结果
 * @param layout 几何与取数口径
 */
function legendOf(
  config: Record<string, unknown>,
  theme: ChartTheme,
  view: BarChartView,
  layout: BarLayout,
): OptionFragment {
  if (!readBoolean(config.showLegend, true)) return { show: false }
  return legendStyle(theme, {
    data: legendData(view, theme, layout),
    fontSize: readNumber(config.legendFontSize, 11),
    // ⚠ 百分比档不许点：占比是取值层一次算死的，点掉一条 echarts 只把那一段
    //   抽走，剩下的加起来不再是 100%，而屏上那些数字一个都没变
    ...(layout.percent ? { selectedMode: false } : {}),
  })
}

/**
 * 全部系列；参考线只挂在挑中的那一条上。
 * @param config 该节点落库的配置
 * @param theme 当前主题色
 * @param view 这一块的取值结果
 * @param layout 几何与取数口径
 */
function allSeries(
  config: Record<string, unknown>,
  theme: ChartTheme,
  view: BarChartView,
  layout: BarLayout,
): OptionFragment[] {
  const host = refHostIndex(view)
  const marks = refLinesOf(config, theme, layout)
  return view.series.map((series, at) =>
    oneSeries(config, theme, series, {
      view,
      layout,
      ...(at === host && marks !== undefined ? { markLine: marks } : {}),
    }),
  )
}

/**
 * 一整块的 option。
 * @param config 该节点落库的配置
 * @param view 这一块的取值结果
 * @param theme 当前主题色
 * @param resolve 变量名 → 实际色值
 */
export function buildBarOption(
  config: Record<string, unknown>,
  view: BarChartView,
  theme: ChartTheme,
  resolve: ColorResolver,
): ECOption {
  const layout = layoutOf(config, view, theme, resolve)
  const zoom = readBoolean(config.showDataZoom, false)
  const values = valueAxes(config, theme, view, layout)
  const category = catAxis(config, theme, view, layout)
  return {
    ...TRANSPARENT_BG,
    ...animationOpts(config),
    // 开了缩放条要给它让出底下那一条，否则滑块压在类目标签上。
    // ⚠ 不开 `containLabel`：echarts 6 已经把它废掉，缺省就按外框收缩、连轴名一起算，
    //   而它需要另注册一个 legacy 组件，没注册时每渲染一帧刷一句 warn 且这个键无效。
    grid: cartesianGrid({
      legend: readBoolean(config.showLegend, true),
      containLabel: false,
      ...(zoom ? { bottom: 34 } : {}),
    }),
    ...(layout.horizontal
      ? { xAxis: values, yAxis: [category] }
      : { xAxis: [category], yAxis: values }),
    tooltip: tooltipOf(config, theme, view, layout),
    legend: legendOf(config, theme, view, layout),
    ...(zoom
      ? {
          dataZoom: dataZoomSlider(theme, {
            orient: layout.horizontal ? 'vertical' : 'horizontal',
            ...(layout.horizontal ? { yAxisIndex: 0 } : { xAxisIndex: 0 }),
          }),
        }
      : {}),
    series: allSeries(config, theme, view, layout),
  }
}
