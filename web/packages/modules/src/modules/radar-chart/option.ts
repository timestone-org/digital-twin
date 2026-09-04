/**
 * @fileoverview radar-chart 的 option：把 `AxisView[]` 铺成一套逐轴量程的雷达网格、
 * 本组与对比组两个封闭形状，以及一条把「哪根轴画不出来、为什么」说清楚的图例。
 * 颜色只从主题与已解析的 `var(--…)` 来，取不到就省掉那个键、交回 echarts 默认。
 *
 * ⚠ 画不出来的那根轴**整根不进 `radar.indicator`**：echarts 的雷达没有「跳过某一维」
 * 的语义，`null` / `NaN` / `'-'` / `undefined` 四种写法出的 SVG 路径与喂 0 逐字节相同，
 * 都落在圆心上——那在图上是一个真实的凹陷，而不是一段空白。
 * ⚠ 剔掉的那几根轴改由图例交代，而图例只认「名字等于某条 series 的 `name`」这一条
 * 认领路径（雷达族的数据项名不参与认领，实测图例里放一个不对应任何 series 的名字，
 * 那一条根本不会被创建）。所以每根被剔掉的轴都以一条 `data: []` 的空 series 出现，
 * 名字由 series 自己带着，图例才列得出来。
 * ⚠ `radar` 必须进 `partialMerge`：轮子上有几根轴是由**实时值**决定的（某根轴取不到
 * 就少一根），只换 series 的话轴还停在上一帧，值与形状当场对不上。
 * ⚠ 超出量程的读数**不会被 echarts 夹回去**（实测 `[0,100]` 的轴上喂 200 会把顶点
 * 画到最外圈之外、压在轴名上）。几何这里自己夹，文案照说原值。
 * ⚠ 数据标签只挂在图元上：`symbol: 'none'` 会让整片标签静默消失，故本族恒画符号。
 * ⚠ 提示框的函数 formatter 返回值被 echarts 原样 `innerHTML`，拼进去的轴名与单位
 * 全是编辑器里的自由输入，一律过 `escapeHtml()`；反过来 series 的标签走 canvas，
 * 不解析 HTML 实体，转义了只会把 `&` 显示成字面量。
 */
import {
  animationOpts,
  escapeHtml,
  legendStyle,
  resolvePalette,
  tooltipStyle,
  TRANSPARENT_BG,
  type ColorResolver,
  type OptionFragment,
} from '../../shared/chart/chartKit'
import type { ECOption } from '../../shared/chart/echarts'
import {
  seriesColor,
  withAlpha,
  withColor,
  type ChartTheme,
} from '../../shared/chart/theme'
import {
  readBoolean,
  readEnum,
  readNumber,
  readRecord,
} from '../../shared/config'
import {
  axisText,
  buildCompareGroup,
  drawnAxes,
  notedAxes,
  ownReadings,
  readGroupNames,
  readRadarFormat,
  type AxisReading,
  type AxisView,
  type CompareGroup,
  type DrawnAxis,
  type GroupNames,
  type RadarFormat,
} from './axes'
import {
  PERCENT_FULL,
  RADAR_AREA_OPACITY_DEFAULT,
  RADAR_AREA_OPACITY_MAX,
  RADAR_AREA_OPACITY_MIN,
  RADAR_MIN_AXES,
  RADAR_SHAPE_VALUES,
  RADAR_SPLIT_DEFAULT,
  RADAR_SPLIT_MAX,
  RADAR_SPLIT_MIN,
  RADAR_STYLE_VALUES,
  type RadarShape,
  type RadarStyle,
} from './options'

/** 轮子的位置与大小；有图例时整体上提，给底部那条图例让位。 */
const CENTER_X = '50%'
const CENTER_Y = '50%'
const CENTER_Y_WITH_LEGEND = '46%'
const RADIUS = '60%'

/** 轴名与数据标签的字号，与 chartKit 各处缺省同值。 */
const LABEL_FONT_SIZE = 11

/** 形状的描边宽度与顶点符号大小。 */
const LINE_WIDTH = 2
const SYMBOL_SIZE = 4

/** 网格分隔线的淡化程度：轮子是背景，不该压过两个形状。 */
const SPLIT_ALPHA = 0.6

/** 提示框里轴名与读数之间那个分隔。 */
const JOIN = ' '

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}

/** echarts 回调参数里我们只用这一个下标，收窄成它免得把整包 params 摊进类型。 */
function seriesIndexOf(params: unknown): number {
  return readNumber(readRecord(params).seriesIndex, -1)
}

/**
 * 一根轴上画出来的那个点：`raw` 是要说给人听的原值，`plotted` 是夹进量程后的坐标。
 * ⚠ 两个数一起带着走：夹的是几何不是数，标签与提示框照说原值，
 * 否则「超了多少」这条信息就没了。
 */
interface GroupReading extends AxisReading {
  plotted: number
}

/**
 * 一条要进 option 的曲线：本组、对比组，以及每根被剔掉的轴各占一条。
 * ⚠ 后两类的 `readings` 是 `null`：它们只为在图例上占一条名字而存在，`data` 给空数组。
 */
export interface RadarGroup {
  /** series 与图例上的名字，画不出来时带上原因后缀。 */
  name: string
  /** 点这一组上抛的联动值；空串 = 点了不上抛。 */
  emitValue: string
  /** 逐轴配好对的读数；`null` = 只占一条图例，不画形状。 */
  readings: GroupReading[] | null
  /** 描边与图元的颜色。 */
  color: string
  /** 图例文字要不要置灰：画不出来的那几条置灰。 */
  isMuted: boolean
}

/**
 * 把一组配好对的读数夹进各自那根轴的量程。
 * @param readings 逐轴配好对的读数
 */
function plotted(readings: readonly AxisReading[]): GroupReading[] {
  return readings.map((item) => ({
    ...item,
    plotted: clamp(item.value, item.axis.range.min, item.axis.range.max),
  }))
}

/**
 * 本组那一条。
 * @param axes 进了轮子的那几根轴
 * @param name 本组的称呼
 * @param color 本组的颜色
 */
function ownGroup(
  axes: readonly DrawnAxis[],
  name: string,
  color: string,
): RadarGroup {
  return {
    name,
    emitValue: name,
    readings: plotted(ownReadings(axes)),
    color,
    isMuted: false,
  }
}

/**
 * 对比组那一条。画不全时只留一条名字带原因的空 series，一个顶点都不画。
 * @param axes 进了轮子的那几根轴
 * @param compare 对比组整条的结论
 * @param name 对比组的称呼
 * @param color 对比组的颜色
 */
function compareGroupOf(
  compare: CompareGroup,
  name: string,
  color: string,
): RadarGroup {
  if (compare.note !== '') {
    return {
      name: `${name}（${compare.note}）`,
      emitValue: name,
      readings: null,
      color,
      isMuted: true,
    }
  }
  return {
    name,
    emitValue: name,
    readings: plotted(compare.readings),
    color,
    isMuted: false,
  }
}

/**
 * 被剔掉的那根轴在图例上占的那一条：只有名字与原因，没有任何数据。
 * @param view 这根轴
 * @param theme 当前主题色
 */
function noteGroupOf(view: AxisView, theme: ChartTheme): RadarGroup {
  return {
    name: view.legendName,
    emitValue: '',
    readings: null,
    color: theme.textMuted,
    isMuted: true,
  }
}

/**
 * 一整块要画的那几条。
 * ⚠ 被剔掉的轴排在两组之后：图例是按这个顺序铺的，两组的名字要先被看见。
 * @param views 这一块的全部轴
 * @param names 两组的称呼
 * @param palette 已解析的色板
 * @param theme 当前主题色
 */
export function buildGroups(
  views: readonly AxisView[],
  names: GroupNames,
  palette: readonly string[],
  theme: ChartTheme,
): RadarGroup[] {
  const axes = drawnAxes(views)
  const compare = buildCompareGroup(axes)
  const groups = [ownGroup(axes, names.series, seriesColor(palette, 0))]
  if (compare.isConfigured) {
    groups.push(compareGroupOf(compare, names.compare, seriesColor(palette, 1)))
  }
  return groups.concat(notedAxes(views).map((view) => noteGroupOf(view, theme)))
}

/**
 * 逐轴量程 → echarts 的 indicator。名字不带后缀：带后缀的那几根根本不在这里。
 * @param axes 进了轮子的那几根轴
 */
function indicatorsOf(axes: readonly DrawnAxis[]): OptionFragment[] {
  return axes.map((axis) => ({
    name: axis.name,
    min: axis.range.min,
    max: axis.range.max,
  }))
}

/**
 * 网格本体。两组共用这一套量程，故形状之间可以直接比长短。
 * @param config 该节点落库的配置
 * @param axes 进了轮子的那几根轴
 * @param theme 当前主题色
 * @param centerY 圆心的纵向位置
 */
function radarGrid(
  config: Record<string, unknown>,
  axes: readonly DrawnAxis[],
  theme: ChartTheme,
  centerY: string,
): OptionFragment {
  const shape: RadarShape = readEnum(
    config.shape,
    RADAR_SHAPE_VALUES,
    'polygon',
  )
  return {
    shape,
    center: [CENTER_X, centerY],
    radius: RADIUS,
    splitNumber: clamp(
      Math.round(readNumber(config.splitCount, RADAR_SPLIT_DEFAULT)),
      RADAR_SPLIT_MIN,
      RADAR_SPLIT_MAX,
    ),
    indicator: indicatorsOf(axes),
    axisName: { fontSize: LABEL_FONT_SIZE, ...withColor(theme.textMuted) },
    axisLine: { lineStyle: { ...withColor(theme.axisLine) } },
    splitLine: {
      lineStyle: { ...withColor(withAlpha(theme.splitLine, SPLIT_ALPHA)) },
    },
    // 隔行底色会把两个半透明的形状搅成四五种深浅，谁压着谁看不出来
    splitArea: { show: false },
  }
}

/**
 * 逐轴的数据标签。⚠ 只有 `dimensionIndex` 是可靠的：`params.value` 是夹过的坐标，
 * 说真话要回查这一组自己的原值。
 * @param group 这一条
 * @param format 整块的数值口径
 */
function labelFormatter(
  group: RadarGroup,
  format: RadarFormat,
): (params: unknown) => string {
  return (params: unknown) => {
    const index = readNumber(readRecord(params).dimensionIndex, -1)
    const reading = group.readings?.[index]
    if (reading === undefined) return ''
    return axisText(reading.value, reading.axis, format)
  }
}

/**
 * 一条 series。画不出来的那几条以 `data: []` 进 option——名字由 series 自己带着，
 * 图例才认领得到；有几条这样的空 series，图例上就有几条状态。
 * @param group 这一条
 * @param axes 进了轮子的那几根轴
 * @param style 描边还是填充
 * @param opts 数值标签与填充不透明度
 */
function radarSeries(
  group: RadarGroup,
  style: RadarStyle,
  opts: { showLabel: boolean; areaOpacity: number; format: RadarFormat },
): OptionFragment {
  const paint = { ...withColor(group.color) }
  return {
    type: 'radar',
    name: group.name,
    // ⚠ 恒画符号：雷达的数据标签挂在图元上，symbol 关掉标签会整片静默消失
    symbol: 'circle',
    symbolSize: SYMBOL_SIZE,
    itemStyle: paint,
    lineStyle: { width: LINE_WIDTH, ...paint },
    ...(style === 'area'
      ? { areaStyle: { opacity: opts.areaOpacity, ...paint } }
      : {}),
    label: opts.showLabel
      ? {
          show: true,
          fontSize: LABEL_FONT_SIZE,
          ...withColor(group.color),
          formatter: labelFormatter(group, opts.format),
        }
      : { show: false },
    data:
      group.readings === null
        ? []
        : [
            {
              name: group.name,
              value: group.readings.map((item) => item.plotted),
            },
          ],
  }
}

/**
 * 提示框那一段：这一组在每根轴上各是多少。
 * ⚠ 返回值被原样 innerHTML，逐段转义。
 * @param groups 这一块要画的那几条
 * @param format 整块的数值口径
 */
function tooltipFormatter(
  groups: readonly RadarGroup[],
  format: RadarFormat,
): (params: unknown) => string {
  return (params: unknown) => {
    const group = groups[seriesIndexOf(params)]
    if (group === undefined || group.readings === null) return ''
    const rows = group.readings.map(
      (item) =>
        `${escapeHtml(item.axis.name)}${JOIN}` +
        escapeHtml(axisText(item.value, item.axis, format)),
    )
    return [escapeHtml(group.name), ...rows].join('<br/>')
  }
}

/**
 * 图例逐条的名字与配色。
 * ⚠ 这一份的每个名字都得有一条同名的 series，否则那一条图例不会被创建。
 * ⚠ 画不出来的那几条文字取 `textMuted` 置灰——图例是这一档唯一能说话的地方。
 * @param groups 这一块要画的那几条
 * @param theme 当前主题色
 */
function legendData(
  groups: readonly RadarGroup[],
  theme: ChartTheme,
): OptionFragment[] {
  return groups.map((group) => ({
    name: group.name,
    textStyle: {
      ...withColor(group.isMuted ? theme.textMuted : theme.text),
    },
    itemStyle: { ...withColor(group.color) },
  }))
}

/**
 * 点某一条上抛的联动值：这一组配置里写的称呼。
 * ⚠ 不上抛轴名：雷达的图元点击落在整条折线上，`params` 里没有可靠的维度下标，
 * 猜一根轴出来会让配好的联动规则接到另一根轴上。
 * ⚠ 被剔掉的那几根轴对应的空 series 排在两组之后，下标越界即空串——它们不是
 * 一组数据，点了不上抛。这份顺序必须与 `buildGroups` 一致，有一条用例钉着。
 * @param config 该节点落库的配置
 * @param views 这一块的全部轴
 * @param params echarts 的图元点击回调参数
 */
export function pickedGroupValue(
  config: Record<string, unknown>,
  views: readonly AxisView[],
  params: unknown,
): string {
  const names = readGroupNames(config)
  const compare = buildCompareGroup(drawnAxes(views))
  const ordered = compare.isConfigured
    ? [names.series, names.compare]
    : [names.series]
  return ordered[seriesIndexOf(params)] ?? ''
}

/**
 * 逐条 series 共用的那几样：标签开关、填充浓度与数值口径。
 * ⚠ 浓度按百分比配、按 0–1 用，且夹进可配区间：手编的配置绕得过面板的 min / max，
 * 填满会让后画的那一组把先画的整个盖掉。
 * @param config 该节点落库的配置
 */
function seriesOptsOf(config: Record<string, unknown>): {
  showLabel: boolean
  areaOpacity: number
  format: RadarFormat
} {
  return {
    showLabel: readBoolean(config.showValueLabel, false),
    areaOpacity:
      clamp(
        readNumber(config.areaOpacity, RADAR_AREA_OPACITY_DEFAULT),
        RADAR_AREA_OPACITY_MIN,
        RADAR_AREA_OPACITY_MAX,
      ) / PERCENT_FULL,
    format: readRadarFormat(config),
  }
}

/**
 * 提示框与图例这两块。图例是逐轴原因唯一的承载面，缺省开着。
 * @param config 该节点落库的配置
 * @param groups 这一块要画的那几条
 * @param theme 当前主题色
 */
function chromeOf(
  config: Record<string, unknown>,
  groups: readonly RadarGroup[],
  theme: ChartTheme,
): OptionFragment {
  const format = readRadarFormat(config)
  return {
    tooltip: readBoolean(config.showTooltip, true)
      ? {
          trigger: 'item',
          ...tooltipStyle(theme),
          formatter: tooltipFormatter(groups, format),
        }
      : { show: false },
    legend: readBoolean(config.showLegend, true)
      ? legendStyle(theme, {
          data: legendData(groups, theme),
          // ⚠ 图例不许点：一半的条目背后是没有数据的空 series，点了什么都不会发生，
          //   一半能点一半点不动比整条都点不动更难解释
          selectedMode: false,
        })
      : { show: false },
  }
}

/**
 * 一整块的 option。
 * ⚠ 画得出来的轴不足 `RADAR_MIN_AXES` 根时**连轮子带 series 一起不写**：两根轴的
 * 雷达是一条线段，空态文案是透明的一层字，压在那条线段上两边都读不清。
 * @param config 该节点落库的配置
 * @param views 这一块的全部轴
 * @param theme 当前主题色
 * @param resolve 变量名 → 实际色值
 */
export function buildRadarOption(
  config: Record<string, unknown>,
  views: readonly AxisView[],
  theme: ChartTheme,
  resolve: ColorResolver,
): ECOption {
  const base = { ...TRANSPARENT_BG, ...animationOpts(config) }
  const axes = drawnAxes(views)
  if (axes.length < RADAR_MIN_AXES) return base
  const groups = buildGroups(
    views,
    readGroupNames(config),
    resolvePalette(config, theme, resolve),
    theme,
  )
  const style: RadarStyle = readEnum(
    config.chartStyle,
    RADAR_STYLE_VALUES,
    'area',
  )
  const seriesOpts = seriesOptsOf(config)
  const centerY = readBoolean(config.showLegend, true)
    ? CENTER_Y_WITH_LEGEND
    : CENTER_Y
  return {
    ...base,
    ...chromeOf(config, groups, theme),
    radar: radarGrid(config, axes, theme, centerY),
    series: groups.map((group) => radarSeries(group, style, seriesOpts)),
  }
}
