/**
 * @fileoverview calendar-heat 一整块的取值：槽键与 `fieldKey`、指标列表的归一化、
 * 逐张状态、把一条历史序列按配置给的时区折成「一天一个数」、色阶量程与整块跨度，
 * 以及空态那几句与点一张日历上抛的值，最后收成一份纯数据的 `MetricView[]`。
 * 纯函数，不碰 DOM 也不碰 echarts。
 *
 * ⚠ 日界一律按 `config.timezone` 给的 IANA 串算，留空即浏览器本地。绝不写死东八区：
 * 同一批读数在不同时区里落在不同的日子上，写死的话换个部署整块错一天且零报错。
 * ⚠ 认不出的时区**不静默回落本地**：那与写死 +8 是同一种错法——屏上照画，只是每一格
 * 都可能错一天。整块画不出来，并把那个认不出的串原样说出来。
 * ⚠ 状态按**清单声明的子槽**逐一去问，不按 `slots` 的键遍历：设计态走 previewBindings
 * 那条路，`slots` 里会多出一个模块自己不认识的 `…Points` 键。
 * ⚠ 触顶（`isTruncated`）必须说清取回的是**哪一段**：日历上「早期那一段没取回」与
 * 「那几天真停机」长得一模一样，一句通用的「数据被截断」分不开这两件事。
 * ⚠ 日期串一律用 `<` 直接比大小，不走 `localeCompare`：ISO 串的字典序就是时间序，
 * 而 `localeCompare` 的结果跟着 locale 走，CI 的 runner 与开发机不是同一个 locale。
 */
import type { ModuleSlotMeta } from '@dt/contracts'

import { valueText } from '../../shared/chart/chartKit'
import {
  readArray,
  readEnum,
  readLooseNumber,
  readRecord,
  readText,
  readTrimmedText,
} from '../../shared/config'
import { isPresent } from '../../shared/format'
import { cellState, type CellState } from '../../shared/slotState'
import {
  DAY_AGGREGATE_DEFAULT,
  DAY_AGGREGATE_VALUES,
  DEFAULT_PRECISION,
  type DayAggregate,
} from './options'

/**
 * 逐日序列的数组绑定槽键。
 * ⚠ 清单与渲染两处都从这里取，不许各写一遍字面量：拼错的那一份既不报错也永远取不到值。
 */
export const DAY_SLOT_KEY = 'dayValues'

/** 指标列表的配置键。一行 = 一张日历。 */
export const METRIC_ITEMS_KEY = 'metrics'

/** 一张日历只有一个子槽：那条时序。逐日归并由前端做，不从后端来。 */
export const DAY_SERIES_FIELD = 'series'

/**
 * 序列落在同一行的伴生键上。
 * ⚠ 它是求值层按 `<子槽键>Points` 拼出来的，模块不声明它，也不许当成绑定槽去问状态。
 */
const DAY_POINTS_FIELD = 'seriesPoints'

/** 整块空态的兜底文案；用户把「空态文案」清空时也用它。 */
export const CALENDAR_EMPTY_TEXT = '暂无数据'

/** 配了来源、却一天读数都没取到时的那一句开头。 */
export const CALENDAR_BLANK_TEXT = '一天的读数都没取到'

/** 没有名称的那一张在标题上的称呼。 */
const UNNAMED_PREFIX = '第 '
const UNNAMED_SUFFIX = ' 张'

/**
 * 一张日历没画出格子的原因。
 * ⚠ 三条各说各的：并成一句「无数据」的代价是「还没到首帧」与「表被删了」在标题上
 * 看着一模一样。
 */
export const METRIC_NOTES = {
  pending: '等首帧',
  error: '取不到',
  empty: '窗内一天都没有',
} as const

/**
 * 认不出的时区那一句。
 * @param zone 配置里写的那个串
 */
export function timezoneFaultText(zone: string): string {
  return `时区「${zone}」认不出来，日界算不了`
}

/**
 * 触顶时的那一句：说清取回的是哪一段。
 * @param first 取回的最早那一天
 * @param last 取回的最晚那一天
 */
export function truncatedNote(first: string, last: string): string {
  return `只到 ${first} 至 ${last}，此外的日期没取回`
}

/** 日期串按 `YYYY-MM-DD` 拼，年月串取它的前 7 个字符。 */
const MONTH_LENGTH = 7

/** 归一化后的一张日历的配置。 */
export interface MetricItem {
  /** ⚠ 空串 = 这一张没起名，标题上按「第 N 张」称呼它。 */
  name: string
  /** ⚠ 不 trim：`'° C'` 这类带空格是用户显式的排版意图。 */
  unit: string
  /** 留空 = 用整块缺省小数位。 */
  precision: number | null
  /** 一天之内那几百个采样归并成一个数的算法。 */
  dayAggregate: DayAggregate
}

/** 一天一格。 */
export interface DayCell {
  /** `YYYY-MM-DD`，按配置给的时区算出来的那一天。 */
  day: string
  value: number
}

/** 一张日历要画的全部东西。 */
export interface MetricView {
  /** 文档序下标，取绑定槽与排版都用它。 */
  index: number
  state: CellState
  /** 标题上的名字，同名时按出现序去重。 */
  name: string
  /** 点这张日历上抛的联动值 = 配置里写的名称；空串 = 点了不上抛。 */
  emitValue: string
  /** 没画出格子（或只画了一段）的原因；空串 = 正常。 */
  note: string
  unit: string
  precision: number
  /** 按天升序；空数组 = 这一张一格都画不出来。 */
  cells: readonly DayCell[]
}

/** 组装一整块要用到的输入。 */
export interface MetricViewsInput {
  config: Record<string, unknown>
  /** `values[DAY_SLOT_KEY]` 的原值，正常是一个逐指标的数组。 */
  rows: unknown
  /** `meta.slots`；缺席表示运行时没下发逐槽结论（设计态与独立挂载）。 */
  slots: Readonly<Record<string, ModuleSlotMeta>> | undefined
}

/**
 * 第 index 张那个子槽的 `fieldKey`。
 * ⚠ index 是**归一化输出**里的文档序：派生绑定行与读值必须喂同一份列表。
 * @param index 归一化后的下标
 */
export function metricFieldKey(index: number): string {
  return `${DAY_SLOT_KEY}[${index}].${DAY_SERIES_FIELD}`
}

/**
 * 把配置里的一行规整成一张日历。缺什么补什么，不丢行。
 * ⚠ 脏行不丢、只补默认：丢一行会让它之后每一条绑定改喂另一张，而绑定的
 * `fieldKey` 是按下标拼的。
 * @param raw 配置数组里的一行
 */
function toItem(raw: unknown): MetricItem {
  const row = readRecord(raw)
  return {
    name: readTrimmedText(row.name),
    unit: readText(row.unit),
    precision: readLooseNumber(row.precision),
    dayAggregate: readEnum(
      row.dayAggregate,
      DAY_AGGREGATE_VALUES,
      DAY_AGGREGATE_DEFAULT,
    ),
  }
}

/**
 * 指标列表的归一化。
 * @param raw `config[METRIC_ITEMS_KEY]` 的原值
 */
export function readMetricItems(raw: unknown): MetricItem[] {
  return readArray(raw).map(toItem)
}

/**
 * 配置里那个时区串。
 * @param config 该节点落库的配置
 */
export function readTimezone(config: Record<string, unknown>): string {
  return readTrimmedText(config.timezone)
}

/** 拼 `YYYY-MM-DD` 要的三段。 */
const DAY_PARTS: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}

/**
 * 钉死的 locale：日期串只当键用，不给人看。
 * ⚠ 不钉的话开发机与 CI 的 runner 各按各的 locale 排月与日，键当场对不上。
 */
const DAY_LOCALE = 'en-US'

/**
 * 按配置给的时区算日界的那个格式化器；认不出的时区给 `null`。
 * ⚠ 留空传的是「不写 `timeZone`」而不是某个默认值：那才是浏览器本地时区。
 * @param zone IANA 时区串，空串 = 浏览器本地
 */
export function dayFormatterOf(zone: string): Intl.DateTimeFormat | null {
  try {
    return new Intl.DateTimeFormat(
      DAY_LOCALE,
      zone === '' ? DAY_PARTS : { ...DAY_PARTS, timeZone: zone },
    )
  } catch {
    return null
  }
}

/**
 * 一个采样时刻落在哪一天。
 * @param formatter 按目标时区建好的格式化器
 * @param at 采样时刻，UTC 毫秒
 */
export function dayKeyOf(formatter: Intl.DateTimeFormat, at: number): string {
  const parts = formatter.formatToParts(new Date(at))
  const pick = (type: string): string =>
    parts.find((part) => part.type === type)?.value ?? ''
  const year = pick('year')
  const month = pick('month')
  const day = pick('day')
  if (year === '' || month === '' || day === '') return ''
  return `${year}-${month}-${day}`
}

/** 序列上的一个点，已经收窄成两个有限数。 */
interface Sample {
  t: number
  v: number
}

/**
 * 取第 index 张注入的那条序列。
 * ⚠ 非数值的读数整点丢掉而不是当成 0：日历上「0」与「那天没采到」是两件事。
 * @param rows 注入袋里那个数组
 * @param index 文档序下标
 */
function samplesAt(rows: readonly unknown[], index: number): Sample[] {
  const row = rows[index]
  const raw = readArray(
    row === undefined ? undefined : readRecord(row)[DAY_POINTS_FIELD],
  )
  const found: Sample[] = []
  for (const item of raw) {
    const point = readRecord(item)
    if (isPresent(point.t) && isPresent(point.v)) {
      found.push({ t: point.t, v: point.v })
    }
  }
  return found
}

/** 取第 index 张注入的末值标量；没有这一行给 undefined。 */
function scalarAt(rows: readonly unknown[], index: number): unknown {
  const row = rows[index]
  return row === undefined ? undefined : readRecord(row)[DAY_SERIES_FIELD]
}

/**
 * 一天之内那一批读数归并成一个数。
 * ⚠ 极值走 `reduce` 而不是把一天的读数摊成实参：1 秒周期的点位一天有八万多个采样，
 * 摊成实参会直接把调用栈撑爆，而爆的地方跟日历一点关系都没有。
 * ⚠ 形参不许叫 `values`：「绑定槽键两侧逐一对上」那条闸按 `values.<键>` 的形状扫源码，
 * 于是 `.length` 与 `.reduce` 会被当成两个模块自己都不知道的绑定槽。
 * @param readings 这一天的全部读数，按时刻升序
 * @param mode 归并算法
 */
export function aggregateDay(
  readings: readonly number[],
  mode: DayAggregate,
): number | null {
  const first = readings[0]
  if (first === undefined) return null
  if (mode === 'last') return readings[readings.length - 1] ?? first
  if (mode === 'max') {
    return readings.reduce((best, item) => (item > best ? item : best), first)
  }
  if (mode === 'min') {
    return readings.reduce((best, item) => (item < best ? item : best), first)
  }
  const sum = readings.reduce((total, item) => total + item, 0)
  return mode === 'avg' ? sum / readings.length : sum
}

/**
 * 一条序列折成「一天一格」。
 * @param samples 这条序列上的全部采样
 * @param formatter 按目标时区建好的格式化器
 * @param mode 逐日归并算法
 */
export function dayCellsOf(
  samples: readonly Sample[],
  formatter: Intl.DateTimeFormat,
  mode: DayAggregate,
): DayCell[] {
  const buckets = new Map<string, number[]>()
  for (const sample of samples) {
    const day = dayKeyOf(formatter, sample.t)
    if (day === '') continue
    const bucket = buckets.get(day)
    if (bucket === undefined) buckets.set(day, [sample.v])
    else bucket.push(sample.v)
  }
  const cells: DayCell[] = []
  for (const [day, readings] of buckets) {
    const value = aggregateDay(readings, mode)
    if (value !== null) cells.push({ day, value })
  }
  return cells.sort((left, right) => (left.day < right.day ? -1 : 1))
}

/**
 * 标题上的名字：没起名的按「第 N 张」称呼，同名的按出现序加后缀去重。
 * ⚠ 不去重的代价是两张日历在标题栏上长得一模一样，而它们各画各的数——
 * 看的人只能靠位置猜哪张是哪张。
 * @param item 归一化后的这一张
 * @param index 文档序下标
 * @param seen 已出现过的名字与它出现的次数
 */
function displayName(
  item: MetricItem,
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
 * 这一张没画出格子（或只画了一段）的原因；一切正常给空串。
 * @param state 这一张所在的档
 * @param cells 折出来的逐日格
 * @param truncated 取数侧报的触顶
 */
function noteOf(
  state: CellState,
  cells: readonly DayCell[],
  truncated: boolean,
): string {
  if (state === 'pending') return METRIC_NOTES.pending
  if (state === 'error') return METRIC_NOTES.error
  const first = cells[0]
  const last = cells[cells.length - 1]
  if (first === undefined || last === undefined) return METRIC_NOTES.empty
  return truncated ? truncatedNote(first.day, last.day) : ''
}

/**
 * 逐张问一次状态、折一次日格。
 * ⚠ 「没配来源」的那几张整张不进输出：标题也不列它们——一块摆了 4 张的日历，
 * 挂着 3 个从没接过点位的空框，比少画它们更难看懂。
 * @param items 归一化后的指标列表
 * @param input 配置、注入袋与逐槽结论
 * @param formatter 按目标时区建好的格式化器
 */
function collect(
  items: readonly MetricItem[],
  input: MetricViewsInput,
  formatter: Intl.DateTimeFormat,
): MetricView[] {
  const rows = readArray(input.rows)
  const hasSlots = input.slots !== undefined
  const seen = new Map<string, number>()
  const found: MetricView[] = []
  items.forEach((item, index) => {
    const slot = input.slots?.[metricFieldKey(index)]
    const state = cellState(slot, scalarAt(rows, index), hasSlots)
    const name = displayName(item, index, seen)
    if (state === 'unbound') return
    const cells =
      state === 'ok'
        ? dayCellsOf(samplesAt(rows, index), formatter, item.dayAggregate)
        : []
    found.push({
      index,
      state,
      name,
      emitValue: item.name,
      note: noteOf(state, cells, slot?.isTruncated === true),
      unit: item.unit,
      precision: item.precision ?? DEFAULT_PRECISION,
      cells,
    })
  })
  return found
}

/**
 * 一整块的日历。
 * ⚠ 时区认不出时整块不画：静默按本地折日与写死东八区是同一种错法。
 * @param input 配置、注入袋与逐槽结论
 */
export function buildMetricViews(input: MetricViewsInput): MetricView[] {
  const formatter = dayFormatterOf(readTimezone(input.config))
  if (formatter === null) return []
  return collect(
    readMetricItems(input.config[METRIC_ITEMS_KEY]),
    input,
    formatter,
  )
}

/**
 * 真画得出格子的那几张。
 * @param views 这一块的全部日历
 */
export function drawnMetrics(views: readonly MetricView[]): MetricView[] {
  return views.filter((view) => view.state === 'ok' && view.cells.length > 0)
}

/** 整块日历横跨的那一段。 */
export interface DaySpan {
  from: string
  to: string
}

/**
 * 整块共用的日期跨度 = 各张取回的日子的并集。
 * ⚠ 各张的取数窗口本来就可以不同（窗口住在每条绑定上），所以跨度只能按取回的点算，
 * 不能拿某一张的窗口当全块的。
 * @param views 这一块的全部日历
 */
export function spanOf(views: readonly MetricView[]): DaySpan | null {
  let from = ''
  let to = ''
  for (const view of drawnMetrics(views)) {
    for (const cell of view.cells) {
      if (from === '' || cell.day < from) from = cell.day
      if (to === '' || cell.day > to) to = cell.day
    }
  }
  return from === '' ? null : { from, to }
}

/** 色阶的两个端点。 */
export interface ValueRange {
  min: number
  max: number
}

/**
 * 读数的实际区间，用来在两个端点都留空时自动定色阶。
 * @param views 这一块的全部日历
 */
export function valueRangeOf(views: readonly MetricView[]): ValueRange | null {
  let min = Number.NaN
  let max = Number.NaN
  for (const view of drawnMetrics(views)) {
    for (const cell of view.cells) {
      if (Number.isNaN(min) || cell.value < min) min = cell.value
      if (Number.isNaN(max) || cell.value > max) max = cell.value
    }
  }
  return Number.isNaN(min) || Number.isNaN(max) ? null : { min, max }
}

/**
 * 这一天那一格的读数文案。
 * @param value 归并后的读数
 * @param view 这一张日历
 */
export function cellText(value: unknown, view: MetricView): string {
  return valueText(value, view.precision, view.unit)
}

/**
 * 日期串里的年月段。
 * @param day `YYYY-MM-DD`
 */
export function monthOf(day: string): string {
  return day.slice(0, MONTH_LENGTH)
}

/** 一年十二个月。 */
const MONTHS_IN_YEAR = 12

/**
 * 逐月推进的上限。
 * ⚠ 有它才不至于在 `to` 比 `from` 还早（脏跨度）时无限推下去把浏览器挂死。
 */
const MAX_MONTHS = 400

/**
 * 一段跨度里逐月的年月串，按时间升序。
 * ⚠ 从年、月两个数直接推，不经 `Date`：跨年那一步靠取模，比造一个日期再读回来
 * 少一层时区。
 * @param span 整块共用的日期跨度
 */
export function monthsOf(span: DaySpan): string[] {
  const from = monthOf(span.from)
  const to = monthOf(span.to)
  const months: string[] = []
  let year = Number(from.slice(0, 4))
  let month = Number(from.slice(5, 7))
  if (!Number.isFinite(year) || !Number.isFinite(month)) return months
  for (let guard = 0; guard < MAX_MONTHS; guard += 1) {
    const key = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`
    months.push(key)
    if (key >= to) break
    month += 1
    if (month > MONTHS_IN_YEAR) {
      month = 1
      year += 1
    }
  }
  return months
}

/** 空态浮层此刻要不要出，以及出的是哪一句。 */
export interface CalendarEmptyState {
  isEmpty: boolean
  text: string
}

/**
 * 一张没画出格子的日历在空态那一句里怎么称呼。
 * ⚠ 只喂没画出格子的那几张：它们的 `note` 一定非空（四档里除了正常都带一句原因），
 * 所以这里不为空串再兜一次底。
 */
function reasonLine(view: MetricView): string {
  return `${view.name}（${view.note}）`
}

/**
 * 空态口径。
 * ⚠ 「时区认不出」「一张都没配」「配了但一天都没取到」三件事各说各的：
 * 合成一句「暂无数据」的代价是看的人不知道该去改配置、去配绑定，还是再等一会儿。
 * @param config 该节点落库的配置
 * @param views 这一块的全部日历
 */
export function emptyStateOf(
  config: Record<string, unknown>,
  views: readonly MetricView[],
): CalendarEmptyState {
  const zone = readTimezone(config)
  if (dayFormatterOf(zone) === null) {
    return { isEmpty: true, text: timezoneFaultText(zone) }
  }
  if (drawnMetrics(views).length > 0) return { isEmpty: false, text: '' }
  if (views.length === 0) {
    return {
      isEmpty: true,
      text: readTrimmedText(config.emptyText) || CALENDAR_EMPTY_TEXT,
    }
  }
  return {
    isEmpty: true,
    text: `${CALENDAR_BLANK_TEXT}：${views.map(reasonLine).join('、')}`,
  }
}

/**
 * 值签名：只含画得出来的那几样，取回的日子一变它就变。
 * ⚠ 它是 `ChartShell` 的 `watchValues` 的返回值，配 `valuesDeep: false` 用——
 * 传解包后的整袋值会让四张 × 三百多天被逐键深度遍历。
 * ⚠ 带上读数之和：天数与首尾都不变、只有今天那一格在长的场合是常态，
 * 光比天数会让整块停在第一帧上。
 * @param views 这一块的全部日历
 */
export function signatureOf(views: readonly MetricView[]): string {
  return views
    .map((view) => {
      const sum = view.cells.reduce((total, cell) => total + cell.value, 0)
      const first = view.cells[0]?.day ?? ''
      const last = view.cells[view.cells.length - 1]?.day ?? ''
      return [
        String(view.index),
        view.state,
        view.note,
        String(view.cells.length),
        first,
        last,
        String(sum),
      ].join(':')
    })
    .join('␟')
}

/**
 * 一张日历上那批读数的高低两头。
 * ⚠ 就地扫一遍而不是回头调 `valueRangeOf`：那一份会给出 `null`，而这里喂进来的
 * 一定是画得出格子的那几张，为一个走不到的档再写一次兜底只会掩盖真正的空档。
 * @param view 画得出格子的那一张
 */
function rangeText(view: MetricView): string {
  let low = Number.POSITIVE_INFINITY
  let high = Number.NEGATIVE_INFINITY
  for (const cell of view.cells) {
    if (cell.value < low) low = cell.value
    if (cell.value > high) high = cell.value
  }
  return `${cellText(low, view)} 至 ${cellText(high, view)}`
}

/**
 * 图区的读屏摘要：canvas 里的一切对读屏是纯空白，只能挂一段文本。
 * ⚠ 一张都没配来源时给空串——`aria-label=""` 会把图区读成一个没名字的图形，
 * 比什么都不写更糟，壳据此把整个属性省掉。
 * ⚠ 没画出格子的那几张也报出来：标题可以被挤到看不清，而读屏这一面挤不着。
 * @param views 这一块的全部日历
 */
export function ariaSummaryOf(views: readonly MetricView[]): string {
  if (views.length === 0) return ''
  const drawn = drawnMetrics(views)
  const blank = views.filter((view) => !drawn.includes(view))
  const parts = drawn.map(
    (view) =>
      `${view.name} ${String(view.cells.length)} 天，${rangeText(view)}`,
  )
  const head =
    drawn.length === 0
      ? '日历热力，一天的读数都没取到'
      : `日历热力，共 ${String(drawn.length)} 张：${parts.join('；')}`
  if (blank.length === 0) return head
  return `${head}；另有 ${String(blank.length)} 张没有读数：${blank.map(reasonLine).join('、')}`
}

/**
 * 绑点面板上每一张叫什么：名字给人看，联动值给人核对。
 * ⚠ 没起名的那几张在墙上不画标题，但在绑点面板上仍得有个称呼——几行全靠数行号
 * 认对象，是这套面板最容易接错的地方。
 * @param config 该节点落库的配置
 */
export function metricRowLabels(
  config: Record<string, unknown>,
): Record<string, { title: string; id: string }> {
  const labels: Record<string, { title: string; id: string }> = {}
  const seen = new Map<string, number>()
  readMetricItems(config[METRIC_ITEMS_KEY]).forEach((item, index) => {
    labels[metricFieldKey(index)] = {
      title: displayName(item, index, seen),
      id: item.name,
    }
  })
  return labels
}

/**
 * 每个数组槽应有几行。
 * ⚠ 一张都没有时也要给 0，别把键漏掉：漏掉的槽会被绑点面板当成「行由用户手工
 * 增删」，于是摆出一个加了也永远喂不到东西的「新增一行」。
 * @param config 该节点落库的配置
 */
export function metricRowCounts(
  config: Record<string, unknown>,
): Record<string, number> {
  return { [DAY_SLOT_KEY]: readMetricItems(config[METRIC_ITEMS_KEY]).length }
}
