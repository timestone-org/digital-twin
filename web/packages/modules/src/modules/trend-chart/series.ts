/**
 * @fileoverview trend-chart 一整块的取值：槽键与 `fieldKey`、系列列表的归一化、
 * 逐条四档状态、历史序列与实时末值的合并、时间跨度，以及空态那三句，
 * 最后收成一份纯数据的 `SeriesView[]`。纯函数，不碰 DOM 也不碰 echarts。
 *
 * ⚠ 四档在注入袋里长得一模一样（键都不存在），全靠 `meta.slots` 分开：合成一档的
 * 代价是「还没绑」与「取不到」在墙上是同一片空白（DASHBOARD_DESIGN §4.3）。
 * ⚠ 状态按**清单声明的子槽**逐一去问，不按 `slots` 的键遍历：设计态走
 * `previewBindings` 那条路，`slots` 里会多出模块自己不认识的 `…Points` 键。
 * ⚠ 序列不在标量那一格里，而在**同一行**的伴生键 `seriesPoints` 上，且已经跑过
 * 与末值同一份定值变换——两边口径必须一致，否则曲线是帕、末值是千帕。
 * ⚠ 取数窗口不在本模块的配置里：它住在每条绑定的取数说明上，由绑点面板写入，
 * 模块读不到也改不了，只能按取回的点算实际跨度（DASHBOARD_CHART_MODULES §3.1）。
 */
import type { ModuleSlotMeta } from '@dt/contracts'

import { valueText } from '../../shared/chart/chartKit'
import {
  readArray,
  readEnum,
  readLooseNumber,
  readNumber,
  readRecord,
  readText,
  readTrimmedText,
} from '../../shared/config'
import { isPresent } from '../../shared/format'
import { cellState, type CellState } from '../../shared/slotState'
import {
  TREND_AXIS_VALUES,
  TREND_LINE_TYPE_VALUES,
  type TrendAxis,
  type TrendLineType,
} from './options'

/**
 * 历史序列的数组绑定槽键。
 * ⚠ 清单与渲染两处都从这里取，不许各写一遍字面量：拼错的那一份既不报错也永远取不到值。
 */
export const SERIES_SLOT_KEY = 'seriesValues'

/** 系列列表的配置键。 */
export const SERIES_ITEMS_KEY = 'series'

/** 行内的时序子槽：历史序列从它来。 */
export const SERIES_HISTORY_FIELD = 'series'

/** 行内的标量子槽：实时末值，可选。 */
export const SERIES_LATEST_FIELD = 'latest'

/**
 * 序列落在同一行的哪个键上。
 * ⚠ 是求值层拼的伴生键（子槽键 + `Points`），不是清单声明的槽——声明它反而会让
 * 「绑定槽键两侧逐一对上」那条闸红在一个根本不存在的槽上。
 */
export const SERIES_POINTS_FIELD = `${SERIES_HISTORY_FIELD}Points`

/** 整块空态的兜底文案；用户把「空态文案」清空时也用它。 */
export const TREND_EMPTY_TEXT = '暂无数据'

/** 取到了，但这几条绑定的窗口里一个点都没有。 */
export const TREND_NO_POINTS_TEXT = '所选时间窗内没有历史数据'

/**
 * 这一页压根没装历史取数时的那一句。
 * ⚠ 公开屏（匿名令牌页）明令不装历史 provider，而历史读侧的两个端点都在认证面上，
 * 于是这块图在那里永远画不出曲线。写通用的「暂无数据」会让人以为是点位没数。
 */
export const TREND_NO_HISTORY_TEXT = '公开屏不提供历史数据'

/**
 * 应用壳里那份**同步**读取器对序列类来源的拒绝原文。
 * ⚠ 这是跨包的一句约定，本包够不到它的定义（`packages/*` 不许依赖 `app/`）。
 * 判据只能是它：装没装历史取数是应用壳的事，模块看得见的只有「每一条时序槽都被
 * 同步读取器原样退回来了」。两边真漂了也不会画错数，只是退回通用空态。
 */
const SYNC_REFUSAL = '序列要异步取数，画布上不展开'

/** 没有名称的那一条在图例上的称呼。 */
const UNNAMED_PREFIX = '第 '
const UNNAMED_SUFFIX = ' 条'

/** 整块缺省小数位，与 `unitPrecisionFields()` 的 help 同口径。 */
const DEFAULT_PRECISION = 2

/**
 * 一条线没画出来（或没画全）的原因，挂在图例名后面。
 * ⚠ 五条各说各的原因：并成一句「无数据」的代价是「还没到首帧」与「表被删了」
 * 在图例上看着一模一样。
 * ⚠ 触顶分早晚两头：两个历史读侧砍的方向是**相反**的——点位逐条读正序取前 N 条、
 * 砍掉晚的那一头，台账序列留最新那一批、砍掉早的那一头。一句通用的「数据被截断」
 * 会让人按错的方向去读那条曲线，而曲线本身完全合法。
 */
export const SERIES_NOTES = {
  pending: '等首帧',
  error: '取不到',
  empty: '窗内无数据',
  early: '早段未取全',
  late: '晚段未取全',
  capped: '点数触顶',
} as const

/** 归一化后的一条系列的配置。 */
export interface SeriesItem {
  /** ⚠ 空串 = 这一条没起名，图例上按「第 N 条」称呼它。 */
  name: string
  /** ⚠ 不 trim：`'° C'` 这类带空格是用户显式的排版意图。 */
  unit: string
  /** 留空 = 跟随整块的小数位。 */
  precision: number | null
  /** 逐条固定色，填了就压过色板；只填 `var(--…)` 引用才跟着换肤走。 */
  color: string
  axis: TrendAxis
  lineType: TrendLineType
}

/** 曲线上的一个点，时刻是 UTC 毫秒。 */
export interface TrendPoint {
  t: number
  v: number
}

/** 一条系列要画的全部东西。 */
export interface SeriesView {
  /** 文档序下标，取绑定槽与取色板都用它。 */
  index: number
  state: CellState
  /** 图例与提示框上的名字，同名时按出现序去重。 */
  legendName: string
  /** 点这条线上抛的联动值 = 这一条配置里写的名称；空串 = 点了不上抛。 */
  emitValue: string
  /** 没画出来（或没画全）的原因；空串 = 正常。 */
  note: string
  /** 取不到时取数侧给的那句话；正常给空串。 */
  message: string
  /** 按时刻升序，已含追加上去的实时末值。 */
  points: readonly TrendPoint[]
  /** 末点的值；一个点都没有给 null。 */
  lastValue: number | null
  /** 末值 + 单位；没有末点给空串。 */
  lastText: string
  /** 这一条自己的单位，留空跟随整块那一档；提示框与数值标签共用它。 */
  unit: string
  /** 这一条自己的小数位，已经补过整块那一档的缺省。 */
  precision: number
  axis: TrendAxis
  lineType: TrendLineType
  /** 逐条固定色的原文，空串 = 交给色板。 */
  color: string
}

/** 整块共用的数值口径。 */
export interface TrendFormat {
  unit: string
  precision: number
}

/** 组装一整块要用到的输入。 */
export interface SeriesViewsInput {
  config: Record<string, unknown>
  /** `values[SERIES_SLOT_KEY]` 的原值，正常是一个系列数组。 */
  rows: unknown
  /** `meta.slots`；缺席表示运行时没下发逐槽结论（设计态与独立挂载）。 */
  slots: Readonly<Record<string, ModuleSlotMeta>> | undefined
}

/**
 * 第 index 条那两个子槽的 `fieldKey`。
 * ⚠ index 是**归一化输出**里的文档序：派生绑定行与读值必须喂同一份列表。
 * @param index 归一化后的下标
 */
export function historyFieldKey(index: number): string {
  return `${SERIES_SLOT_KEY}[${index}].${SERIES_HISTORY_FIELD}`
}

/**
 * 第 index 条实时末值那个子槽的 `fieldKey`。
 * @param index 归一化后的下标
 */
export function latestFieldKey(index: number): string {
  return `${SERIES_SLOT_KEY}[${index}].${SERIES_LATEST_FIELD}`
}

/**
 * 把配置里的一行规整成一条系列。缺什么补什么，不丢行。
 * ⚠ 脏行不丢、只补默认：丢一行会让它之后每一条绑定改喂另一条系列，而绑定的
 * `fieldKey` 是按下标拼的。
 * @param raw 配置数组里的一行
 */
function toItem(raw: unknown): SeriesItem {
  const row = readRecord(raw)
  return {
    name: readTrimmedText(row.name),
    unit: readText(row.unit),
    precision: readLooseNumber(row.precision),
    color: readTrimmedText(row.color),
    axis: readEnum(row.axis, TREND_AXIS_VALUES, 'left'),
    lineType: readEnum(row.lineType, TREND_LINE_TYPE_VALUES, 'solid'),
  }
}

/**
 * 系列列表的归一化。
 * @param raw `config[SERIES_ITEMS_KEY]` 的原值
 */
export function readSeriesItems(raw: unknown): SeriesItem[] {
  return readArray(raw).map(toItem)
}

/**
 * 整块的单位与小数位。
 * @param config 该节点落库的配置
 */
export function readTrendFormat(config: Record<string, unknown>): TrendFormat {
  return {
    unit: readText(config.unit),
    precision: readNumber(config.precision, DEFAULT_PRECISION),
  }
}

/**
 * 一行里的历史序列。
 * ⚠ 时刻或值不是有限数的点整点丢掉：它们在时间轴上没有位置，留着只会让 echarts
 * 把整条线画断在一个没人解释得清的地方。
 * @param row 注入袋里这一行
 */
function pointsOf(row: Record<string, unknown>): TrendPoint[] {
  const found: TrendPoint[] = []
  for (const raw of readArray(row[SERIES_POINTS_FIELD])) {
    const point = readRecord(raw)
    const t = point.t
    const v = point.v
    if (isPresent(t) && isPresent(v)) found.push({ t, v })
  }
  return found
}

/**
 * 把实时末值追加成曲线的末点。
 * ⚠ **只认严格晚于末点的时刻**，时刻缺席一律不追加：末值本身说不出自己是什么
 * 时候采的，硬接在曲线尾巴上等于凭空长出一个位置不明的点，而那个点会把整条线
 * 的右端拉到一个错的时刻上。
 * @param points 历史序列，按时刻升序
 * @param raw 注入袋里这一行的实时末值
 * @param slot 实时末值那一槽的取数结论
 */
function withLatest(
  points: TrendPoint[],
  raw: unknown,
  slot: ModuleSlotMeta | undefined,
): TrendPoint[] {
  const at = slot?.timestampMs
  if (at === undefined || !isPresent(raw)) return points
  const last = points.at(-1)
  if (last !== undefined && at <= last.t) return points
  return [...points, { t: at, v: raw }]
}

/**
 * 这一条没画出来（或没画全）的原因；一切正常给空串。
 * @param state 这一条所在的档
 * @param slot 历史序列那一槽的取数结论
 * @param count 取回来的点数
 */
function noteOf(
  state: CellState,
  slot: ModuleSlotMeta | undefined,
  count: number,
): string {
  if (state === 'pending') return SERIES_NOTES.pending
  if (state === 'error') return SERIES_NOTES.error
  if (count === 0) return SERIES_NOTES.empty
  if (slot?.isTruncated !== true) return ''
  if (slot.truncatedSide === 'early') return SERIES_NOTES.early
  return slot.truncatedSide === 'late' ? SERIES_NOTES.late : SERIES_NOTES.capped
}

/**
 * 图例上的名字：没起名的按「第 N 条」称呼，同名的按出现序加后缀去重。
 * ⚠ 不去重的代价是 echarts 把同名的两条并成一条图例，而两条线仍各画各的——
 * 图例上少一行，且没有任何报错。
 * @param item 归一化后的这一条
 * @param index 文档序下标
 * @param seen 已出现过的名字与它出现的次数
 */
function displayName(
  item: SeriesItem,
  index: number,
  seen: Map<string, number>,
): string {
  const base =
    item.name === ''
      ? `${UNNAMED_PREFIX}${String(index + 1)}${UNNAMED_SUFFIX}`
      : item.name
  const count = seen.get(base) ?? 0
  seen.set(base, count + 1)
  return count === 0 ? base : `${base}#${String(count)}`
}

/**
 * 逐条的数值口径：自己配了就用自己的，缺了才用整块那一份。
 * @param item 归一化后的这一条
 * @param format 整块的单位与小数位
 */
function formatOf(item: SeriesItem, format: TrendFormat): TrendFormat {
  return {
    unit: item.unit || format.unit,
    precision: item.precision ?? format.precision,
  }
}

/** 一条系列的两个子槽此刻各是什么。 */
interface RowState {
  state: CellState
  points: TrendPoint[]
  message: string
}

/**
 * 问一条系列的两个子槽：历史序列定状态，实时末值只补末点。
 * @param index 文档序下标
 * @param input 配置、注入袋与逐槽结论
 * @param rows 注入袋里的整个行数组
 */
function rowStateOf(
  index: number,
  input: SeriesViewsInput,
  rows: readonly unknown[],
): RowState {
  const row = readRecord(rows[index])
  const slot = input.slots?.[historyFieldKey(index)]
  const state = cellState(
    slot,
    row[SERIES_POINTS_FIELD],
    input.slots !== undefined,
  )
  const points =
    state === 'ok' || state === 'unbound'
      ? withLatest(
          pointsOf(row),
          row[SERIES_LATEST_FIELD],
          input.slots?.[latestFieldKey(index)],
        )
      : []
  return { state, points, message: slot?.message ?? '' }
}

/**
 * 一整块的系列。
 * ⚠ 「没配来源」的那几条整条不进输出：图例也不列它们——一块摆了 6 条的趋势图，
 * 图例上挂着 4 条从没接过点位的空名字，比少画它们更难看懂。
 * @param input 配置、注入袋与逐槽结论
 */
export function buildSeriesViews(input: SeriesViewsInput): SeriesView[] {
  const format = readTrendFormat(input.config)
  const rows = readArray(input.rows)
  const seen = new Map<string, number>()
  const found: SeriesView[] = []
  readSeriesItems(input.config[SERIES_ITEMS_KEY]).forEach((item, index) => {
    const row = rowStateOf(index, input, rows)
    const name = displayName(item, index, seen)
    if (row.state === 'unbound') return
    const note = noteOf(
      row.state,
      input.slots?.[historyFieldKey(index)],
      row.points.length,
    )
    const last = row.points.at(-1)
    const own = formatOf(item, format)
    found.push({
      index,
      state: row.state,
      legendName: note === '' ? name : `${name}（${note}）`,
      emitValue: item.name,
      note,
      message: row.message,
      points: row.points,
      lastValue: last?.v ?? null,
      lastText:
        last === undefined ? '' : valueText(last.v, own.precision, own.unit),
      unit: own.unit,
      precision: own.precision,
      axis: item.axis,
      lineType: item.lineType,
      color: item.color,
    })
  })
  return found
}

/**
 * 值签名：只含画得出来的那几样，取一轮数它就变。
 * ⚠ 它是 `ChartShell` 的 `watchValues` 的返回值，配 `valuesDeep: false` 用——
 * 6 条系列 × 几百个点被逐键深度遍历一遍，每个节拍都来一次。
 * ⚠ 只取行数、各行点数、末点与状态这几样廉价指纹，不遍历整条序列：中间几个点
 * 变了而末点没变，是同一轮取数里不可能出现的形状。
 * @param views 这一块的全部系列
 */
export function signatureOf(views: readonly SeriesView[]): string {
  return views
    .map((view) => {
      const last = view.points.at(-1)
      return [
        String(view.index),
        view.state,
        view.note,
        String(view.points.length),
        String(last?.t ?? ''),
        String(last?.v ?? ''),
      ].join(':')
    })
    .join('␟')
}

/** 画得出线的那几条：状态是 ok 且至少有一个点。 */
export function drawnViews(views: readonly SeriesView[]): SeriesView[] {
  return views.filter((view) => view.state === 'ok' && view.points.length > 0)
}

/**
 * 全部曲线一起铺出来的时刻跨度，毫秒；铺不出来给 0。
 * ⚠ 按**取回的点**算而不是按配置：窗口住在每条绑定上，而同一块图里两条系列的
 * 窗口允许不一样，时间轴要能同时容下它们。
 * @param views 这一块的全部系列
 */
export function spanOf(views: readonly SeriesView[]): number {
  let low = Number.POSITIVE_INFINITY
  let high = Number.NEGATIVE_INFINITY
  for (const view of drawnViews(views)) {
    const first = view.points[0]
    const last = view.points.at(-1)
    if (first !== undefined) low = Math.min(low, first.t)
    if (last !== undefined) high = Math.max(high, last.t)
  }
  return high > low ? high - low : 0
}

/**
 * 这一页装没装历史取数。
 * ⚠ 判据是「每一条时序槽都被同步读取器原样退回来了」，不是猜路由：公开屏那条
 * 路只是最常见的一种，设计态画布与模块库缩略图走的是同一条。
 * @param views 这一块的全部系列
 */
export function historyUnavailable(views: readonly SeriesView[]): boolean {
  return (
    views.length > 0 &&
    views.every(
      (view) => view.state === 'error' && view.message === SYNC_REFUSAL,
    )
  )
}

/** 空态浮层此刻要不要出，以及出的是哪一句。 */
export interface TrendEmptyState {
  isEmpty: boolean
  text: string
}

/**
 * 空态口径。
 * ⚠ 三句各说各的：「这一页没有历史取数」「取到了但窗内没有点」「还没接上」是
 * 三件不同的事，合成一句「暂无数据」的话，公开屏上一块永远画不出来的图看着
 * 只是「现场还没数」。
 * @param config 该节点落库的配置
 * @param views 这一块的全部系列
 */
export function emptyStateOf(
  config: Record<string, unknown>,
  views: readonly SeriesView[],
): TrendEmptyState {
  if (drawnViews(views).length > 0) return { isEmpty: false, text: '' }
  if (historyUnavailable(views)) {
    return { isEmpty: true, text: TREND_NO_HISTORY_TEXT }
  }
  if (views.some((view) => view.state === 'ok')) {
    return { isEmpty: true, text: TREND_NO_POINTS_TEXT }
  }
  return {
    isEmpty: true,
    text: readTrimmedText(config.emptyText) || TREND_EMPTY_TEXT,
  }
}

/**
 * 图区的读屏摘要：canvas 里的一切对读屏是纯空白，只能挂一段文本。
 * ⚠ 一条都没配来源时给空串——`aria-label=""` 会把图区读成一个没名字的图形，
 * 比什么都不写更糟，壳据此把整个属性省掉。
 * ⚠ 没画出来的那几条也报出来：图例可以被关掉，而读屏这一面是关不掉的。
 * @param views 这一块的全部系列
 */
export function ariaSummaryOf(views: readonly SeriesView[]): string {
  if (views.length === 0) return ''
  const drawn = drawnViews(views)
  const blank = views.filter((view) => !drawn.includes(view))
  const parts = drawn.map(
    (view) =>
      `${view.legendName} ${String(view.points.length)} 个点，末值 ${view.lastText}`,
  )
  const head =
    drawn.length === 0
      ? '趋势曲线，一条都画不出来'
      : `趋势曲线，共 ${String(drawn.length)} 条：${parts.join('；')}`
  if (blank.length === 0) return head
  const names = blank.map((view) => view.legendName).join('、')
  return `${head}；另有 ${String(blank.length)} 条没有画出来：${names}`
}

/**
 * 绑点面板上每一条叫什么：名字给人看，联动值给人核对。
 * ⚠ 没起名的那几条在墙上不画图例名，但在绑点面板上仍得有个称呼——十几行全靠数
 * 行号认对象，是这套面板最容易接错的地方。
 * ⚠ 键取的是**这一行第一个子槽**的 `fieldKey`，两个子槽共用这一个组标题。
 * @param config 该节点落库的配置
 */
export function seriesRowLabels(
  config: Record<string, unknown>,
): Record<string, { title: string; id: string }> {
  const labels: Record<string, { title: string; id: string }> = {}
  const seen = new Map<string, number>()
  readSeriesItems(config[SERIES_ITEMS_KEY]).forEach((item, index) => {
    labels[historyFieldKey(index)] = {
      title: displayName(item, index, seen),
      id: item.name,
    }
  })
  return labels
}

/**
 * 每个数组槽应有几行。
 * ⚠ 一条都没有时也要给 0，别把键漏掉：漏掉的槽会被绑点面板当成「行由用户手工
 * 增删」，于是摆出一个加了也永远喂不到东西的「新增一行」。
 * @param config 该节点落库的配置
 */
export function seriesRowCounts(
  config: Record<string, unknown>,
): Record<string, number> {
  return { [SERIES_SLOT_KEY]: readSeriesItems(config[SERIES_ITEMS_KEY]).length }
}
