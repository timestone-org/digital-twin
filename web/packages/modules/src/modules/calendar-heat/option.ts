/**
 * @fileoverview calendar-heat 的 option：把 `MetricView[]` 铺成上下堆叠的几块，
 * 每块一条标题、一套坐标（日历格或月 × 日矩阵）、一组热力格，底下共用一条色标。
 * 颜色只从主题派生，取不到就省掉那个键、交回 echarts 默认。
 *
 * ⚠ 逐张状态只有**标题**这一个承载面：日历族没有图例可挂（热力格的图例是色标，
 * 它说的是数值区间不是数据源状态），`graphic` 组件没有注册（写了静默不渲染），
 * 而模块标题条走 `ModulePanel`。所以取不到 / 等首帧的那几张是「日历框照画、
 * 一格不出、标题带后缀并置灰」。
 * ⚠ 没画出格子的那几张**仍然进 option**（`series.data` 给空数组、坐标照建）：
 * 撤掉它们的话「这块指标坏了」与「这块指标没配」在屏上是同一片空白。
 * ⚠ 一块里的几张日历**共用一条色阶**：色阶的两个端点是整块级配置。所以同一块里
 * 只该摆同量纲的指标——0–100 的达标率与 0–5000 的能耗挤在一条色标上，达标率那张
 * 会整片一个色。要混量纲请再放一块。
 * ⚠ 色阶一个色都派生不出时不写 `inRange`（`visualMapContinuous` 已经这么做），
 * 别自己补一套默认色：补出来的那套不跟着换肤走。
 * ⚠ 提示框的函数 formatter 返回值被 echarts 原样 `innerHTML`，拼进去的指标名与单位
 * 全是编辑器里的自由输入，一律过 `escapeHtml()`。
 * ⚠ 月名与星期名逐个写死成数组喂给 echarts，不走它的 locale：CI 的 runner 与开发机
 * 不是同一个 locale，交给它挑会让同一份配置在两台机器上画出两种月名。
 */
import {
  animationOpts,
  categoryAxis,
  escapeHtml,
  tooltipStyle,
  visualMapContinuous,
  TRANSPARENT_BG,
  type OptionFragment,
} from '../../shared/chart/chartKit'
import type { ECOption } from '../../shared/chart/echarts'
import { withColor, type ChartTheme } from '../../shared/chart/theme'
import {
  readArray,
  readBoolean,
  readEnum,
  readLooseNumber,
  readNumber,
  readRecord,
  readText,
} from '../../shared/config'
import { fmtTrim } from '../../shared/format'
import {
  cellText,
  monthOf,
  monthsOf,
  spanOf,
  valueRangeOf,
  type DaySpan,
  type MetricView,
  type ValueRange,
} from './days'
import {
  CALENDAR_STYLE_VALUES,
  CELL_GAP_DEFAULT,
  CELL_GAP_MAX,
  CELL_GAP_MIN,
  COLOR_SCALE_VALUES,
  type CalendarStyle,
} from './options'

/** 图区左右两侧的留白：左边要摆得下星期名或年月名。 */
const CHART_LEFT = 44
const CHART_RIGHT = 12

/** 每一块顶上留给标题的高度（百分点）。 */
const TITLE_ROOM = 9

/** 两块之间的空隙（百分点）。 */
const BLOCK_GAP = 3

/** 底部色标占的高度；没有色标时只留一点边（百分点）。 */
const SCALE_ROOM = 16
const BARE_ROOM = 4

/** 一块日历再挤也留这么高，免得算出负高度让整块不画（百分点）。 */
const MIN_BLOCK = 8

/** 标题、坐标文字与提示框的字号，与 chartKit 各处缺省同值。 */
const TITLE_FONT_SIZE = 12
const LABEL_FONT_SIZE = 11

/** 星期名，`dayLabel.nameMap` 从周日起数。 */
const DAY_NAMES = ['日', '一', '二', '三', '四', '五', '六'] as const

/** 月名，`monthLabel.nameMap` 从一月起数。 */
const MONTH_NAMES = [
  '1月',
  '2月',
  '3月',
  '4月',
  '5月',
  '6月',
  '7月',
  '8月',
  '9月',
  '10月',
  '11月',
  '12月',
] as const

/** 矩阵铺法横轴上的「几号」。 */
const DAYS_IN_MONTH = 31
const DAY_NUMBERS = Array.from({ length: DAYS_IN_MONTH }, (_, index) =>
  String(index + 1),
)

/** 百分比的小数位：两位足够把四块分匀，多了只是把 option 撑长。 */
const PCT_DIGITS = 2

/** 年月串的长度，`YYYY-MM`。 */
const MONTH_KEY_LENGTH = 7

function pct(value: number): string {
  return `${fmtTrim(value, PCT_DIGITS)}%`
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

/**
 * 只在颜色非空时给出 `{ borderColor }`，否则空对象。
 * ⚠ 与 `withColor` 同一条纪律：写 `borderColor: ''` 会让 echarts 把空串当成一种颜色
 * 画出透明的边，而不是回退默认。
 * @param color 已解析的色值
 */
function withBorderColor(color: string): { borderColor?: string } {
  return color ? { borderColor: color } : {}
}

/** 一块日历在画布上的三个纵向位置。 */
interface BlockBox {
  titleTop: string
  top: string
  height: string
}

/**
 * 上下均分成 count 块，底下按要不要色标留位置。
 * @param count 要摆几块
 * @param hasScale 底下有没有色标
 */
export function blocksOf(count: number, hasScale: boolean): BlockBox[] {
  const room = hasScale ? SCALE_ROOM : BARE_ROOM
  const share = (100 - room) / Math.max(count, 1)
  return Array.from({ length: count }, (_, index) => {
    const base = index * share
    return {
      titleTop: pct(base + 1),
      top: pct(base + TITLE_ROOM),
      height: pct(Math.max(share - TITLE_ROOM - BLOCK_GAP, MIN_BLOCK)),
    }
  })
}

/**
 * 色阶的两个端点：两个都填了就照填的来，只填一个的那一头按数据自动定。
 * ⚠ `minValue` / `maxValue` 刻意没有 `default`，「留空 = 自动」与「真的填了 0」
 * 因此分得开——给了缺省就再也回不到自动。
 * ⚠ 填反了按小的那个当下限：报错的话屏上只剩一句错误，而两个数本身都合法。
 * @param config 该节点落库的配置
 * @param views 这一块的全部日历
 */
export function scaleOf(
  config: Record<string, unknown>,
  views: readonly MetricView[],
): ValueRange | null {
  const low = readLooseNumber(config.minValue)
  const high = readLooseNumber(config.maxValue)
  if (low !== null && high !== null) {
    return { min: Math.min(low, high), max: Math.max(low, high) }
  }
  const range = valueRangeOf(views)
  if (range === null) return null
  const min = low ?? range.min
  const max = high ?? range.max
  return { min: Math.min(min, max), max: Math.max(min, max) }
}

/**
 * 标题上那一行：名字 + 单位 +（没画出格子或只画了一段的）原因。
 * @param view 这一张日历
 */
export function titleTextOf(view: MetricView): string {
  const base = view.unit === '' ? view.name : `${view.name} · ${view.unit}`
  return view.note === '' ? base : `${base}（${view.note}）`
}

/**
 * 逐张一条标题。
 * ⚠ 这是逐张状态唯一的承载面，`error` / `pending` 那两档的文字取 `textMuted` 置灰。
 * @param views 这一块的全部日历
 * @param boxes 各块的纵向位置
 * @param theme 当前主题色
 */
function titlesOf(
  views: readonly MetricView[],
  boxes: readonly BlockBox[],
  theme: ChartTheme,
): OptionFragment[] {
  return views.map((view, index) => ({
    text: titleTextOf(view),
    left: 0,
    top: boxes[index]?.titleTop,
    textStyle: {
      fontSize: TITLE_FONT_SIZE,
      ...withColor(view.note === '' ? theme.text : theme.textMuted),
    },
  }))
}

/**
 * 一块日历坐标。
 * ⚠ `cellSize: 'auto'` 配 `left`/`right`/`top`/`height` 才有意义：不给这四项时
 * echarts 反过来按 `cellSize` 推整块的尺寸，几块会重叠着摞在一起。
 * @param box 这一块的纵向位置
 * @param span 整块共用的日期跨度
 * @param theme 当前主题色
 */
function calendarOf(
  box: BlockBox | undefined,
  span: DaySpan,
  theme: ChartTheme,
): OptionFragment {
  return {
    left: CHART_LEFT,
    right: CHART_RIGHT,
    top: box?.top,
    height: box?.height,
    cellSize: 'auto',
    range: [span.from, span.to],
    splitLine: { lineStyle: { ...withColor(theme.axisLine) } },
    // 没数据那一天露出来的就是这层底色，热力格盖在它上面
    itemStyle: { borderWidth: 0, ...withColor(theme.splitLine) },
    dayLabel: {
      fontSize: LABEL_FONT_SIZE,
      nameMap: [...DAY_NAMES],
      ...withColor(theme.textMuted),
    },
    monthLabel: {
      fontSize: LABEL_FONT_SIZE,
      nameMap: [...MONTH_NAMES],
      ...withColor(theme.textMuted),
    },
    // 年份写在图里会跟月名挤成一团，跨度由标题与提示框交代
    yearLabel: { show: false },
  }
}

/**
 * 一块矩阵坐标。
 * ⚠ 不走 `cartesianGrid()`：那一份出的是单块的四边留白，摆不了「第 i 块从这里起、
 * 占这么高」。
 * @param box 这一块的纵向位置
 */
function gridOf(box: BlockBox | undefined): OptionFragment {
  return {
    left: CHART_LEFT,
    right: CHART_RIGHT,
    top: box?.top,
    height: box?.height,
    containLabel: false,
  }
}

/**
 * 热力格自己的描边：格与格之间那道缝画成分隔线色。
 * ⚠ 缝不是画成背景色的：图表背景是透明的（卡片框那层背景由 host 铺），
 * 拿背景色描边等于描一个看不见的东西。
 * @param config 该节点落库的配置
 * @param theme 当前主题色
 */
function cellStyle(
  config: Record<string, unknown>,
  theme: ChartTheme,
): OptionFragment {
  const gap = Math.min(
    CELL_GAP_MAX,
    Math.max(CELL_GAP_MIN, readNumber(config.cellGap, CELL_GAP_DEFAULT)),
  )
  return { borderWidth: gap, ...withBorderColor(theme.splitLine) }
}

/** 日历坐标上的一格：`[日期, 读数]`。 */
function calendarData(view: MetricView): unknown[][] {
  return view.cells.map((cell) => [cell.day, cell.value])
}

/** 矩阵坐标上的一格：`[几号, 第几个年月, 读数]`。 */
function matrixData(view: MetricView, months: readonly string[]): unknown[][] {
  const found: unknown[][] = []
  for (const cell of view.cells) {
    const row = months.indexOf(monthOf(cell.day))
    const column = Number(cell.day.slice(MONTH_KEY_LENGTH + 1)) - 1
    if (row >= 0 && column >= 0) found.push([column, row, cell.value])
  }
  return found
}

/**
 * 提示框那一行。⚠ 返回值被原样 innerHTML，逐段转义。
 * @param views 这一块的全部日历
 * @param months 矩阵铺法纵轴上的年月
 * @param style 铺法
 */
function tooltipFormatter(
  views: readonly MetricView[],
  months: readonly string[],
  style: CalendarStyle,
): (params: unknown) => string {
  return (params: unknown) => {
    const record = readRecord(params)
    const view = views[readNumber(record.seriesIndex, -1)]
    if (view === undefined) return ''
    const cell = readArray(record.value)
    const onCalendar = style === 'calendar'
    const day = onCalendar
      ? readText(cell[0])
      : `${months[readNumber(cell[1], -1)] ?? ''}-${pad2(readNumber(cell[0], -1) + 1)}`
    const value = cell[onCalendar ? 1 : 2]
    return `${escapeHtml(day)}<br/>${escapeHtml(view.name)} ${escapeHtml(cellText(value, view))}`
  }
}

/**
 * 点某一格时上抛的联动值：那张日历配置里写的名称，没起名就不上抛。
 * ⚠ 不上抛日期：一年三百多个日期没法在联动规则里逐个配，而 `setActive` 这类动作
 * 是按值匹配的——上抛日期等于配了一条永远匹配不上的规则。日期在提示框里。
 * @param views 这一块的全部日历
 * @param params echarts 的图元点击回调参数
 */
export function pickedMetricValue(
  views: readonly MetricView[],
  params: unknown,
): string {
  return views[readNumber(readRecord(params).seriesIndex, -1)]?.emitValue ?? ''
}

/** 这一帧的坐标与取色，日历与矩阵两条铺法共用一份入参。 */
interface PaintInput {
  config: Record<string, unknown>
  views: readonly MetricView[]
  theme: ChartTheme
  boxes: readonly BlockBox[]
  span: DaySpan
  months: readonly string[]
}

/** 日历铺法：一块一套日历坐标，热力格挂在它上面。 */
function calendarLayers(input: PaintInput): OptionFragment {
  const style = cellStyle(input.config, input.theme)
  return {
    calendar: input.views.map((_, index) =>
      calendarOf(input.boxes[index], input.span, input.theme),
    ),
    series: input.views.map((view, index) => ({
      type: 'heatmap',
      coordinateSystem: 'calendar',
      calendarIndex: index,
      name: view.name,
      data: calendarData(view),
      itemStyle: style,
    })),
  }
}

/** 矩阵铺法：横轴是几号、纵轴是年月，一块一套直角坐标。 */
function matrixLayers(input: PaintInput): OptionFragment {
  const style = cellStyle(input.config, input.theme)
  const axisText = {
    labelFontSize: LABEL_FONT_SIZE,
    boundaryGap: true,
  }
  return {
    grid: input.views.map((_, index) => gridOf(input.boxes[index])),
    xAxis: input.views.map((_, index) => ({
      ...categoryAxis(input.theme, [...DAY_NUMBERS], axisText),
      gridIndex: index,
    })),
    // 年月按升序进 data：类目轴从底往上排，于是最近的那个月落在最上面
    yAxis: input.views.map((_, index) => ({
      ...categoryAxis(input.theme, [...input.months], axisText),
      gridIndex: index,
    })),
    series: input.views.map((view, index) => ({
      type: 'heatmap',
      xAxisIndex: index,
      yAxisIndex: index,
      name: view.name,
      data: matrixData(view, input.months),
      itemStyle: style,
    })),
  }
}

/**
 * 提示框那一块，关掉时只留一个 `show: false`。
 * ⚠ 收成一个返回 `OptionFragment` 的函数而不是就地写字面量：写在一个没有上下文类型的
 * `const` 里时 `trigger: 'item'` 会被推宽成 `string`，而 echarts 的 option 要的是闭合联合。
 * @param config 该节点落库的配置
 * @param theme 当前主题色
 * @param views 这一块的全部日历
 * @param months 矩阵铺法纵轴上的年月
 */
function tooltipOf(
  config: Record<string, unknown>,
  theme: ChartTheme,
  views: readonly MetricView[],
  months: readonly string[],
  style: CalendarStyle,
): OptionFragment {
  if (!readBoolean(config.showTooltip, true)) return { show: false }
  return {
    trigger: 'item',
    ...tooltipStyle(theme),
    formatter: tooltipFormatter(views, months, style),
  }
}

/**
 * 一整块的 option。
 * @param config 该节点落库的配置
 * @param views 这一块的全部日历
 * @param theme 当前主题色
 */
export function buildCalendarOption(
  config: Record<string, unknown>,
  views: readonly MetricView[],
  theme: ChartTheme,
): ECOption {
  const style: CalendarStyle = readEnum(
    config.chartStyle,
    CALENDAR_STYLE_VALUES,
    'calendar',
  )
  const span = spanOf(views)
  const months = span === null ? [] : monthsOf(span)
  const scale = scaleOf(config, views)
  const base: ECOption = {
    ...TRANSPARENT_BG,
    ...animationOpts(config),
    tooltip: tooltipOf(config, theme, views, months, style),
  }
  // 一天都没取到时连坐标都不建：日历的横轴是真实日期，没有日期就没有轴。
  // ⚠ 有跨度就一定有量程（跨度是从画得出格子的那几张来的），两个条件写在一起
  //   是为了让下面拿得到收窄后的量程，不是两种情形
  if (span === null || scale === null) return base
  const boxes = blocksOf(views.length, true)
  const input: PaintInput = { config, views, theme, boxes, span, months }
  return {
    ...base,
    title: titlesOf(views, boxes, theme),
    ...(style === 'calendar' ? calendarLayers(input) : matrixLayers(input)),
    visualMap: visualMapContinuous(theme, {
      min: scale.min,
      max: scale.max,
      diverging:
        readEnum(config.colorScale, COLOR_SCALE_VALUES, 'sequential') ===
        'diverging',
      orient: 'horizontal',
      left: 'center',
      bottom: 0,
    }),
  }
}
