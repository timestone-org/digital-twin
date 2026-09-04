/**
 * @fileoverview pie-chart 的 option：把 `SliceView[]` 铺成一组扇区、一条图例、
 * 一个提示框，以及环心那一个派生读数。颜色只从主题与已解析的 `var(--…)` 来，
 * 取不到就省掉那个键、交回 echarts 默认。
 *
 * ⚠ 逐片状态只有**图例**这一个承载面：`graphic` 组件没有注册（写了静默不渲染），
 * 而模块标题条走 `ModulePanel`。没进扇区的那几片因此只在图例上列名字 + 后缀。
 * ⚠ 没读数的那几片**也要进 `series.data`**（值给 `null`、逐项关掉标签与引线）：
 * echarts 只认「名字是系列名」或「名字在饼的原始数据里」这两条，两条都不中的图例项
 * 连图元都不建，dev 下只打一句 warn——图例上那几条状态会整片消失且零报错。
 * ⚠ `stillShowZeroSum: false`：读数全是 0 时 echarts 默认把圆等分成 N 份，
 * 画出来的「各占 1/N」是凭空造的——取值层那边算不出占比时给的是 null。
 * ⚠ 图例不许点：默认可点切换会让 echarts 按剩下的几片重新归一圆心角，而标签与
 * 提示框里的占比是取值层一次算死的，两个数当场对不上。
 * ⚠ 环心读数走 `title` 组件：它是已注册的组件里唯一能在画布正中摆一段文本的。
 * 它随实时值变，所以壳的 `partialMerge` 必须把 `title` 一起纳入替换范围，
 * 否则值刷新时环心那个数字停在第一帧上，而扇区跟着变——两个数当场对不上。
 * ⚠ 提示框的函数 formatter 返回值被 echarts 原样 `innerHTML`，拼进去的名字与单位
 * 全是编辑器里的自由输入，一律过 `escapeHtml()`；反过来 series 的标签走 canvas，
 * 不解析 HTML 实体，转义了只会把 `&` 显示成 `&amp;`。
 */
import {
  animationOpts,
  escapeHtml,
  legendStyle,
  resolvePalette,
  tooltipStyle,
  TRANSPARENT_BG,
  valueText,
  type ColorResolver,
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
  readBoolean,
  readEnum,
  readNumber,
  readRecord,
  readTrimmedText,
} from '../../shared/config'
import {
  PIE_CENTER_LABELS,
  PIE_CENTER_TEXT_VALUES,
  PIE_INNER_RADIUS_DEFAULT,
  PIE_MIN_RING,
  PIE_OUTER_RADIUS_DEFAULT,
  PIE_RADIUS_MAX,
  PIE_RADIUS_MIN,
  PIE_STYLE_VALUES,
  type PieCenterText,
  type PieStyle,
} from './options'
import { readPieFormat, type SliceView } from './slices'

/** 圆心的横向位置恒居中；纵向在有图例时上提，给底部那条图例让位。 */
const CENTER_X = '50%'
const CENTER_Y = '50%'
const CENTER_Y_WITH_LEGEND = '45%'

/** 扇区标签与图例的字号，与 chartKit 各处缺省同值。 */
const LABEL_FONT_SIZE = 11
const CENTER_FONT_SIZE = 22

/** 提示框里读数与占比之间那个分隔。 */
const JOIN = ' · '

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}

/** echarts 回调参数里我们只用这一个下标，收窄成它免得把整包 params 摊进类型。 */
function indexOf(params: unknown): number {
  return readNumber(readRecord(params).dataIndex, -1)
}

/**
 * 这一片画什么颜色：逐片固定色优先，其次按**文档序**取色板。
 * ⚠ 按文档序而不是按「第几片画得出来」取色：否则前面一片一断线，后面每一片的
 * 颜色都跟着挪一格，屏上看着像换了一套配色。
 * @param view 这一片
 * @param palette 已解析的色板
 * @param resolve 变量名 → 实际色值
 */
function colorOf(
  view: SliceView,
  palette: readonly string[],
  resolve: ColorResolver,
): string {
  return resolveColor(view.color, resolve) || seriesColor(palette, view.index)
}

/**
 * 内外半径。
 * ⚠ 内半径填得不小于外半径时环带宽度为 0，整块空白且零报错，所以压到留得下
 * `PIE_MIN_RING` 的位置——画得窄比画不出来诚实。
 * @param config 该节点落库的配置
 * @param style 几何档
 */
function radiusOf(
  config: Record<string, unknown>,
  style: PieStyle,
): [string, string] {
  const outer = clamp(
    readNumber(config.outerRadius, PIE_OUTER_RADIUS_DEFAULT),
    PIE_RADIUS_MIN,
    PIE_RADIUS_MAX,
  )
  if (style === 'pie') return ['0%', `${String(outer)}%`]
  const wanted = clamp(
    readNumber(config.innerRadius, PIE_INNER_RADIUS_DEFAULT),
    PIE_RADIUS_MIN,
    PIE_RADIUS_MAX,
  )
  const inner = Math.min(wanted, Math.max(outer - PIE_MIN_RING, PIE_RADIUS_MIN))
  return [`${String(inner)}%`, `${String(outer)}%`]
}

/**
 * 扇区上那两行字：名字一行，读数与占比一行。canvas 不解析实体，不转义。
 * ⚠ 下标按**文档序**取：没读数的那几片也占着 data 的位置，跳过它们会让
 * 每一片的标签串到相邻那一片上去。
 */
function labelFormatter(
  views: readonly SliceView[],
): (params: unknown) => string {
  return (params: unknown) => {
    const view = views[indexOf(params)]
    if (view === undefined || view.value === null) return ''
    const tail = view.shareText === '' ? '' : `${JOIN}${view.shareText}`
    return `${view.legendName}\n${view.text}${tail}`
  }
}

/** 提示框那一行。⚠ 返回值被原样 innerHTML，逐段转义。 */
function tooltipFormatter(
  views: readonly SliceView[],
): (params: unknown) => string {
  return (params: unknown) => {
    const view = views[indexOf(params)]
    if (view === undefined) return ''
    if (view.value === null) return escapeHtml(view.legendName)
    const tail =
      view.shareText === '' ? '' : `${JOIN}${escapeHtml(view.shareText)}`
    return `${escapeHtml(view.legendName)}<br/>${escapeHtml(view.text)}${tail}`
  }
}

/**
 * 点某一片时上抛的联动值：这一片配置里写的名称，没起名就不上抛。
 * ⚠ 不上抛图例名：重名的那几片图例名带 `#1` 后缀、没起名的是「第 N 片」，
 * 前者没人猜得到，后者在上面插一片就整体挪位——配好的联动规则会静默失配。
 * @param views 这一块的全部扇区
 * @param params echarts 的图元点击回调参数
 */
export function pickedSliceValue(
  views: readonly SliceView[],
  params: unknown,
): string {
  return views[indexOf(params)]?.emitValue ?? ''
}

/**
 * 图例逐条的名字与配色。
 * ⚠ 没进扇区的那几片仍列在这里：它们是「配了但现在没有数」，而完全没配来源的
 * 那几片在取值层就整片剔掉了，两者在图例上必须长得不一样。
 * ⚠ 这一份的每个名字都得在 `series.data` 里找得到同名项，否则那一条图例不会被创建。
 * ⚠ `error` 那一档的文字取 `textMuted` 置灰——图例是这一档唯一能说话的地方。
 * @param views 这一块的全部扇区
 * @param theme 当前主题色
 * @param palette 已解析的色板
 * @param resolve 变量名 → 实际色值
 */
function legendData(
  views: readonly SliceView[],
  theme: ChartTheme,
  palette: readonly string[],
  resolve: ColorResolver,
): OptionFragment[] {
  return views.map((view) => ({
    name: view.legendName,
    textStyle: {
      ...withColor(view.state === 'error' ? theme.textMuted : theme.text),
    },
    itemStyle: {
      ...withColor(
        view.value === null ? theme.textMuted : colorOf(view, palette, resolve),
      ),
    },
  }))
}

/** 环心读数：一个数与一行小字；`none` 档或一片都画不出来时不画。 */
interface CenterReadout {
  text: string
  label: string
}

/**
 * 环心那个派生读数。
 * ⚠ 只有环形与玫瑰有心可写：实心饼上压一段文字会盖在扇区上，两边都读不清。
 * @param config 该节点落库的配置
 * @param style 几何档
 * @param numbers 画得出来的那几片的读数
 */
function centerReadout(
  config: Record<string, unknown>,
  style: PieStyle,
  numbers: readonly number[],
): CenterReadout | null {
  const mode: PieCenterText = readEnum(
    config.centerText,
    PIE_CENTER_TEXT_VALUES,
    'none',
  )
  if (mode === 'none' || style === 'pie' || numbers.length === 0) return null
  const format = readPieFormat(config)
  const unit = readTrimmedText(config.centerUnit)
  if (mode === 'count') {
    return {
      text: valueText(numbers.length, 0, unit),
      label: PIE_CENTER_LABELS[mode],
    }
  }
  const value =
    mode === 'sum'
      ? numbers.reduce((sum, item) => sum + item, 0)
      : Math.max(...numbers)
  return {
    text: valueText(value, format.precision, unit || format.unit),
    label: PIE_CENTER_LABELS[mode],
  }
}

/** 环心那一段的排版：整体锚在圆心上，不随文字长度左右漂。 */
function centerTitle(
  readout: CenterReadout,
  theme: ChartTheme,
  centerY: string,
): OptionFragment {
  return {
    text: readout.text,
    subtext: readout.label,
    left: CENTER_X,
    top: centerY,
    textAlign: 'center',
    textVerticalAlign: 'middle',
    textStyle: { fontSize: CENTER_FONT_SIZE, ...withColor(theme.text) },
    subtextStyle: { fontSize: LABEL_FONT_SIZE, ...withColor(theme.textMuted) },
  }
}

/** 这一帧的几何与取色，`pieSeries` 与 `buildPieOption` 共用一份。 */
interface PieLayout {
  style: PieStyle
  /** 圆心的纵向位置，有图例时上提。 */
  centerY: string
  colorOf: (view: SliceView) => string
}

/**
 * 扇区本体。
 * ⚠ 没读数的那几片以 `value: null` 占着自己的位置：名字进了原始数据，图例那一条
 * 才建得起来；`null` 不进分母、不画弧，逐项再把标签与引线关掉。
 */
function pieSeries(
  config: Record<string, unknown>,
  theme: ChartTheme,
  views: readonly SliceView[],
  layout: PieLayout,
): OptionFragment {
  const showLabel = readBoolean(config.showValueLabel, true)
  return {
    type: 'pie',
    radius: radiusOf(config, layout.style),
    center: [CENTER_X, layout.centerY],
    ...(layout.style === 'rose' ? { roseType: 'radius' } : {}),
    avoidLabelOverlap: true,
    // 读数全是 0 时不等分圆：那是凭空造出来的「各占 1/N」
    stillShowZeroSum: false,
    label: showLabel
      ? {
          show: true,
          position: 'outside',
          fontSize: LABEL_FONT_SIZE,
          ...withColor(theme.textMuted),
          formatter: labelFormatter(views),
        }
      : { show: false },
    labelLine: {
      show: showLabel,
      lineStyle: { ...withColor(theme.axisLine) },
    },
    data: views.map((view) => ({
      name: view.legendName,
      value: view.value,
      itemStyle: {
        ...withColor(
          view.value === null ? theme.textMuted : layout.colorOf(view),
        ),
      },
      ...(view.value === null
        ? { label: { show: false }, labelLine: { show: false } }
        : {}),
    })),
  }
}

/**
 * 一整块的 option。
 * @param config 该节点落库的配置
 * @param views 这一块的全部扇区
 * @param theme 当前主题色
 * @param resolve 变量名 → 实际色值
 */
export function buildPieOption(
  config: Record<string, unknown>,
  views: readonly SliceView[],
  theme: ChartTheme,
  resolve: ColorResolver,
): ECOption {
  const style: PieStyle = readEnum(config.chartStyle, PIE_STYLE_VALUES, 'donut')
  const palette = resolvePalette(config, theme, resolve)
  // ⚠ 缺省开着：图例是逐片四档唯一的承载面，关着等于「取不到的那几片一声不吭」
  const showLegend = readBoolean(config.showLegend, true)
  const centerY = showLegend ? CENTER_Y_WITH_LEGEND : CENTER_Y
  const numbers = views
    .map((view) => view.value)
    .filter((value): value is number => value !== null)
  const readout = centerReadout(config, style, numbers)
  const layout: PieLayout = {
    style,
    centerY,
    colorOf: (view: SliceView) => colorOf(view, palette, resolve),
  }
  return {
    ...TRANSPARENT_BG,
    ...animationOpts(config),
    ...(readout === null
      ? {}
      : { title: centerTitle(readout, theme, centerY) }),
    tooltip: readBoolean(config.showTooltip, true)
      ? {
          trigger: 'item',
          ...tooltipStyle(theme),
          formatter: tooltipFormatter(views),
        }
      : { show: false },
    legend: showLegend
      ? legendStyle(theme, {
          data: legendData(views, theme, palette, resolve),
          // ⚠ 图例不许点：点掉一片 echarts 会按剩下的重新归一圆心角，而标签与
          //   提示框里的占比是取值层一次算死的，两个数当场对不上
          selectedMode: false,
        })
      : { show: false },
    series: [pieSeries(config, theme, views, layout)],
  }
}
