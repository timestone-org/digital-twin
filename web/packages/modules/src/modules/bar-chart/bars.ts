/**
 * @fileoverview bar-chart 一整块的取值：槽键与 `fieldKey`、行列表的归一化、
 * 逐行四档状态、实时档与历史档各自的类目轴、按列归一出的百分比，
 * 以及空态那两句与点一根柱上抛的值，最后收成一份纯数据的 `BarChartView`。
 * 纯函数，不碰 DOM 也不碰 echarts。
 *
 * ⚠ 四档在注入袋里长得一模一样（键都不存在），全靠 `meta.slots` 分开：合成一档的
 * 代价是「还没绑」与「取不到」在墙上是同一片空白（DASHBOARD_DESIGN §4.3）。
 * ⚠ 状态按**清单声明的子槽**逐一去问，不按 `slots` 的键遍历：设计态走
 * `previewBindings` 那条路，`slots` 里会多出模块自己不认识的 `…Points` 键。
 * ⚠ 两档的类目轴不是一回事：实时档的类目是各行的名字，历史档的类目是时间桶。
 * 硬凑成一份的代价是实时档凭空多出一根时间轴，而历史档的行名无处可放。
 * ⚠ 负值是真读数（回馈电量、温差），一律照实带下去，不取绝对值。
 */
import type { HistoryPoint, ModuleSlotMeta } from '@dt/contracts'

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
import { fmtTrim, isPresent } from '../../shared/format'
import { cellState, type CellState } from '../../shared/slotState'
import { alignTo, buildGrid } from './buckets'
import {
  BAR_AXIS_VALUES,
  BAR_DEFAULT_PRECISION,
  BAR_PLOT_VALUES,
  BAR_SHARE_DIGITS,
  BAR_VALUE_SOURCE_VALUES,
  type BarAxis,
  type BarPlot,
  type BarValueSource,
} from './options'

/**
 * 行读数的数组绑定槽键。
 * ⚠ 清单与渲染两处都从这里取，不许各写一遍字面量：拼错的那一份既不报错也永远取不到值。
 */
export const BAR_SLOT_KEY = 'barValues'

/** 行列表的配置键。 */
export const BAR_ITEMS_KEY = 'items'

/** 实时档读的子槽：一行 = 一根柱。 */
export const BAR_VALUE_FIELD = 'value'

/** 历史档读的子槽：一行 = 一个系列，时间桶做类目。 */
export const BAR_SERIES_FIELD = 'series'

/** 整块空态的兜底文案；用户把「空态文案」清空时也用它。 */
export const BAR_EMPTY_TEXT = '暂无数据'

/**
 * 历史档一行都取不到时的那一句。
 * ⚠ 与通用的「暂无数据」分开：公开大屏根本不装历史取数（`PublicDashboard` 明令
 * 不装 history provider），那不是现场没数据，而是这一档在公开屏上就取不到。
 */
export const BAR_HISTORY_EMPTY_TEXT = '取不到历史序列（公开大屏不提供历史数据）'

/**
 * 应用壳里那份**同步**读取器对序列类来源的拒绝原文。
 * ⚠ 这是跨包的一句约定，本包够不到它的定义（`packages/*` 不许依赖 `app/`）。
 * 判据只能是它：装没装历史取数是应用壳的事，模块看得见的只有「每一行的时序槽都被
 * 同步读取器原样退回来了」。两边真漂了也不会画错数，只是退回通用空态。
 */
const SYNC_REFUSAL = '序列要异步取数，画布上不展开'

/** 没有名称的那一行在图例上的称呼。 */
const UNNAMED_PREFIX = '第 '
const UNNAMED_SUFFIX = ' 行'

/**
 * 一行没画出来（或画得不全）时挂在图例名后面的后缀。
 * ⚠ 逐条各说各的原因：并成一句「无数据」的代价是「还没到首帧」与「表被删了」
 * 在图例上看着一模一样。
 * ⚠ 触顶分早晚两头：两个历史读侧砍的方向是**相反**的——点位逐条读正序取前 N 条、
 * 砍掉晚的那一头，台账序列留最新那一批、砍掉早的那一头。方向由 `truncatedSide`
 * 带回来，取数侧说不出方向时才退回通用的那一句。
 */
export const BAR_NOTES = {
  pending: '等首帧',
  error: '取不到',
  empty: '窗内无数据',
  early: '早段未取全',
  late: '晚段未取全',
  truncated: '窗内还有更多点',
  stale: '陈旧',
  ignoredHistory: '历史未用',
  ignoredLive: '实时未用',
} as const

/** 后缀之间的分隔；一行可能同时「陈旧」又「还有更多点」。 */
const NOTE_JOIN = ' · '

/** 归一化后的一行的配置。 */
export interface BarItem {
  /** ⚠ 空串 = 这一行没起名，图例上按「第 N 行」称呼它。 */
  name: string
  /** ⚠ 不 trim：`'° C'` 这类带空格是用户显式的排版意图。 */
  unit: string
  /** 留空 = 跟随整块的小数位。 */
  precision: number | null
  /** 逐行固定色，填了就压过色板；只填 `var(--…)` 引用才跟着换肤走。 */
  color: string
  /** 堆叠分组名，空串 = 这一行不与别人堆。 */
  stack: string
  plot: BarPlot
  axis: BarAxis
}

/** 一行要画的全部东西。 */
export interface BarSeriesView {
  /** 文档序下标，取绑定槽与取色板都用它。 */
  index: number
  state: CellState
  /** 图例上的名字，同名时按出现序去重。 */
  legendName: string
  /** 点这一行上抛的联动值 = 配置里写的名称；空串 = 这一行点了不上抛。 */
  emitValue: string
  /** 没画满的原因；空串 = 正常。 */
  note: string
  /** 取数侧给的原文；空串 = 没说话。空态那一句靠它认出「这一页没装历史取数」。 */
  message: string
  item: BarItem
  /**
   * 与类目轴等长的读数；null = 这一格没有数。
   * ⚠ 非 ok 的行给**空数组**：series 仍要进 option（图例靠 `series.name` 认领它），
   * 但一格都不画。
   */
  data: (number | null)[]
  /** 百分比档的占比（0–100），与 `data` 等长；null = 这一列算不出分母。 */
  shares: (number | null)[]
}

/** 一整块的取值结果。 */
export interface BarChartView {
  source: BarValueSource
  /** 类目轴：实时档是行名，历史档是时间桶刻度。 */
  categories: string[]
  series: BarSeriesView[]
}

/** 整块共用的数值口径。 */
export interface BarFormat {
  unit: string
  precision: number
}

/** 组装一整块要用到的输入。 */
export interface BarViewsInput {
  config: Record<string, unknown>
  /** `values[BAR_SLOT_KEY]` 的原值，正常是一个行数组。 */
  rows: unknown
  /** `meta.slots`；缺席表示运行时没下发逐槽结论（设计态与独立挂载）。 */
  slots: Readonly<Record<string, ModuleSlotMeta>> | undefined
}

/**
 * 第 index 行某个子槽的 `fieldKey`。
 * ⚠ index 是**归一化输出**里的文档序：派生绑定行与读值必须喂同一份列表。
 * @param index 归一化后的下标
 * @param field 子槽键
 */
export function barFieldKey(index: number, field: string): string {
  return `${BAR_SLOT_KEY}[${String(index)}].${field}`
}

/**
 * 把配置里的一行规整成一条系列。缺什么补什么，不丢行。
 * ⚠ 脏行不丢、只补默认：丢一行会让它之后每一条绑定改喂另一行，而绑定的
 * `fieldKey` 是按下标拼的。
 * @param raw 配置数组里的一行
 */
function toItem(raw: unknown): BarItem {
  const row = readRecord(raw)
  return {
    name: readTrimmedText(row.name),
    unit: readText(row.unit),
    precision: readLooseNumber(row.precision),
    color: readTrimmedText(row.color),
    stack: readTrimmedText(row.stack),
    plot: readEnum(row.plot, BAR_PLOT_VALUES, 'bar'),
    axis: readEnum(row.axis, BAR_AXIS_VALUES, 'left'),
  }
}

/**
 * 行列表的归一化。
 * @param raw `config[BAR_ITEMS_KEY]` 的原值
 */
export function readBarItems(raw: unknown): BarItem[] {
  return readArray(raw).map(toItem)
}

/**
 * 这一块读哪一路。
 * @param config 该节点落库的配置
 */
export function readValueSource(
  config: Record<string, unknown>,
): BarValueSource {
  return readEnum(config.valueSource, BAR_VALUE_SOURCE_VALUES, 'live')
}

/**
 * 整块的单位与小数位。
 * @param config 该节点落库的配置
 */
export function readBarFormat(config: Record<string, unknown>): BarFormat {
  return {
    unit: readText(config.unit),
    precision: readNumber(config.precision, BAR_DEFAULT_PRECISION),
  }
}

/**
 * 图例上的名字：没起名的按「第 N 行」称呼，同名的按出现序加后缀去重。
 * ⚠ 不去重的代价是 echarts 把同名的两条系列并成一条图例，而两行的值仍各画各的——
 * 图例上少一行，且没有任何报错。
 * @param item 归一化后的这一行
 * @param index 文档序下标
 * @param seen 已出现过的名字与它出现的次数
 */
function displayName(
  item: BarItem,
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

/** 取第 index 行注入的某个键；没有这一行给 undefined。 */
function rawAt(rows: readonly unknown[], index: number, key: string): unknown {
  const row = rows[index]
  return row === undefined ? undefined : readRecord(row)[key]
}

/**
 * 注入袋里第 index 行的序列。
 * ⚠ 缺席时给 `undefined` 而不是空数组：求值层规定「取不到」一个点都不写，
 * 而「取到了但窗内没数据」写的是空数组，两者在屏上是两句不同的话。
 * ⚠ 逐点重建而不是整段透传：`HistoryPoint.v` 在契约上是 `unknown`，
 * 注入袋里那一段是运行期数据，形状只能逐字段问。
 */
function pointsAt(
  rows: readonly unknown[],
  index: number,
): HistoryPoint[] | undefined {
  const raw = rawAt(rows, index, `${BAR_SERIES_FIELD}Points`)
  if (!Array.isArray(raw)) return undefined
  return raw.map((entry) => {
    const point = readRecord(entry)
    return { t: readNumber(point.t, Number.NaN), v: point.v }
  })
}

/** 把几段后缀拼成一句，空段一律不占位。 */
function joinNotes(...parts: readonly string[]): string {
  return parts.filter((part) => part !== '').join(NOTE_JOIN)
}

/**
 * 触顶那一句：砍的是哪一头由取数侧带回来，说不出方向才退回通用的那一句。
 * @param slot 这一槽的取数结论
 */
function truncatedNote(slot: ModuleSlotMeta): string {
  if (slot.truncatedSide === 'early') return BAR_NOTES.early
  return slot.truncatedSide === 'late' ? BAR_NOTES.late : BAR_NOTES.truncated
}

/**
 * 这一行的后缀。
 * @param state 这一行所在的档
 * @param slot 这一槽的取数结论
 * @param ignored 另一路绑了却没被读的那一档；空串 = 没有被忽略的绑定
 */
function noteOf(
  state: CellState,
  slot: ModuleSlotMeta | undefined,
  ignored: string,
): string {
  const parts: string[] = []
  if (state === 'pending') parts.push(BAR_NOTES.pending)
  else if (state === 'error') parts.push(BAR_NOTES.error)
  else {
    if (slot?.isStale === true) parts.push(BAR_NOTES.stale)
    if (slot?.isTruncated === true) parts.push(truncatedNote(slot))
  }
  return joinNotes(...parts, ignored)
}

/**
 * 另一路绑了却没被这一档读的说明。
 * ⚠ 不标出来的话，把「历史序列」那一路绑好之后切回实时档，屏上还是老样子，
 * 而用户看不到任何解释，只会以为自己绑错了点位。
 * @param slots 逐槽结论
 * @param index 文档序下标
 * @param source 这一块此刻读的是哪一路
 */
function ignoredNoteOf(
  slots: Readonly<Record<string, ModuleSlotMeta>> | undefined,
  index: number,
  source: BarValueSource,
): string {
  const other = source === 'live' ? BAR_SERIES_FIELD : BAR_VALUE_FIELD
  if (slots?.[barFieldKey(index, other)] === undefined) return ''
  return source === 'live' ? BAR_NOTES.ignoredHistory : BAR_NOTES.ignoredLive
}

/** 归一化前的一行：状态与原始读数已定，还没铺到类目轴上。 */
interface RawRow {
  index: number
  state: CellState
  /** 去重后的名字，还没挂后缀。 */
  name: string
  /** 状态与被忽略那一路带来的后缀；「窗内无数据」要等铺完格子才知道。 */
  note: string
  /** 取数侧给的原文；空串 = 没说话。 */
  message: string
  item: BarItem
  /** 实时档的那一个读数。 */
  value: number | null
  /** 历史档取回的序列；缺席 = 这一行没有序列。 */
  points: HistoryPoint[] | undefined
}

/**
 * 逐行问一次状态与读数。
 * ⚠ 「没配来源」的那几行整行不进输出：图例也不列它们——一块摆了 6 行的柱图，
 * 图例上挂着 4 条从没接过点位的空名字，比少画它们更难看懂。
 * @param items 归一化后的行列表
 * @param input 配置、注入袋与逐槽结论
 * @param source 这一块此刻读的是哪一路
 */
function collect(
  items: readonly BarItem[],
  input: BarViewsInput,
  source: BarValueSource,
): RawRow[] {
  const rows = readArray(input.rows)
  const hasSlots = input.slots !== undefined
  const field = source === 'live' ? BAR_VALUE_FIELD : BAR_SERIES_FIELD
  const seen = new Map<string, number>()
  const found: RawRow[] = []
  items.forEach((item, index) => {
    const raw = rawAt(rows, index, field)
    const slot = input.slots?.[barFieldKey(index, field)]
    const state = cellState(slot, raw, hasSlots)
    const name = displayName(item, index, seen)
    if (state === 'unbound') return
    found.push({
      index,
      state,
      name,
      note: noteOf(state, slot, ignoredNoteOf(input.slots, index, source)),
      message: slot?.message ?? '',
      item,
      value: state === 'ok' && isPresent(raw) ? raw : null,
      points: state === 'ok' ? pointsAt(rows, index) : undefined,
    })
  })
  return found
}

/**
 * 逐列的分母。
 * ⚠ 一整列全缺时给 `null` 而不是 0：分母为 0 的那一列必须整列留空，画成 0%
 * 会让「这一桶没采到」看着像「这一桶产量为零」。
 * ⚠ 合计 ≤ 0 也给 `null`：占比对负值与零和没有几何意义。
 * @param columns 逐列的读数
 */
function totalsOf(columns: readonly (number | null)[][]): (number | null)[] {
  return columns.map((column) => {
    const numbers = column.filter((value): value is number => value !== null)
    if (numbers.length === 0) return null
    const total = numbers.reduce((sum, value) => sum + value, 0)
    return total > 0 ? total : null
  })
}

/** 把逐行的读数转置成逐列，算分母用。 */
function columnsOf(
  rows: readonly (number | null)[][],
  width: number,
): (number | null)[][] {
  const columns: (number | null)[][] = []
  for (let at = 0; at < width; at += 1) {
    columns.push(rows.map((row) => row[at] ?? null))
  }
  return columns
}

/**
 * 实时档：类目 = 各行的名字，一行只在自己那一格上有读数。
 * ⚠ 分母取的是**全部行的合计**：实时档每一列只有一个读数，按列归一会让每一根柱
 * 都恒等于 100%，那个数没有任何信息。
 * @param raws 逐行的状态与读数
 */
function liveGrid(raws: readonly RawRow[]): {
  categories: string[]
  data: (number | null)[][]
  totals: (number | null)[]
} {
  const width = raws.length
  const data = raws.map((raw, at) =>
    Array.from({ length: width }, (_, cell) =>
      cell === at && raw.state === 'ok' ? raw.value : null,
    ),
  )
  const numbers = raws
    .map((raw) => (raw.state === 'ok' ? raw.value : null))
    .filter((value): value is number => value !== null)
  const sum = numbers.reduce((total, value) => total + value, 0)
  const shared = numbers.length > 0 && sum > 0 ? sum : null
  return {
    categories: raws.map((raw) => raw.name),
    data,
    totals: Array.from({ length: width }, () => shared),
  }
}

/**
 * 历史档：类目 = 全部行时刻的并集，逐行按时刻对齐。
 * @param raws 逐行的状态与序列
 */
function historyGrid(raws: readonly RawRow[]): {
  categories: string[]
  data: (number | null)[][]
  totals: (number | null)[]
} {
  const grid = buildGrid(raws.map((raw) => raw.points))
  const data = raws.map((raw) =>
    raw.state === 'ok' ? alignTo(grid.stamps, raw.points) : [],
  )
  return {
    categories: grid.labels,
    data,
    totals: totalsOf(columnsOf(data, grid.stamps.length)),
  }
}

/**
 * 一整块的取值。
 * @param input 配置、注入袋与逐槽结论
 */
export function buildBarViews(input: BarViewsInput): BarChartView {
  const source = readValueSource(input.config)
  const raws = collect(readBarItems(input.config[BAR_ITEMS_KEY]), input, source)
  const grid = source === 'live' ? liveGrid(raws) : historyGrid(raws)
  const series = raws.map((raw, at) => {
    // 非 ok 的行 series 照常进 option、一格都不画：图例靠 series.name 认领它
    const data = raw.state === 'ok' ? (grid.data[at] ?? []) : []
    // 取到了但窗内一格都没有，与「取不到」是两码事，各说各的
    const blank = raw.state === 'ok' && !data.some((value) => value !== null)
    const note = blank ? joinNotes(raw.note, BAR_NOTES.empty) : raw.note
    return {
      index: raw.index,
      state: raw.state,
      legendName: note === '' ? raw.name : `${raw.name}（${note}）`,
      emitValue: raw.item.name,
      note,
      message: raw.message,
      item: raw.item,
      data,
      shares: data.map((value, cell) => {
        const total = grid.totals[cell] ?? null
        return value === null || total === null ? null : (value / total) * 100
      }),
    }
  })
  return { source, categories: grid.categories, series }
}

/**
 * 一行在某一格上的读数文案：逐行单位与小数位优先，缺了才用整块那一份。
 * @param value 这一格的读数
 * @param item 归一化后的这一行
 * @param format 整块的数值口径
 */
export function cellText(
  value: number | null,
  item: BarItem,
  format: BarFormat,
): string {
  if (value === null) return ''
  return valueText(
    value,
    item.precision ?? format.precision,
    item.unit || format.unit,
  )
}

/**
 * 占比文案，形如 `42.5%`；算不出给空串。
 * @param share 占比（0–100）
 */
export function shareText(share: number | null): string {
  return share === null ? '' : `${fmtTrim(share, BAR_SHARE_DIGITS)}%`
}

/**
 * 值签名：只含画得出来的那几样，实时值一变它就变。
 * ⚠ 它是 `ChartShell` 的 `watchValues` 的返回值，配 `valuesDeep: false` 用——
 * 传解包后的整袋值会让 8 行 × 数百个桶被逐键深度遍历。
 * @param view 这一块的取值结果
 */
export function signatureOf(view: BarChartView): string {
  const head = `${view.source}:${view.categories.join(',')}`
  const body = view.series.map(
    (series) =>
      `${String(series.index)}:${series.state}:${series.note}:${series.data.join(',')}`,
  )
  return [head, ...body].join('␟')
}

/** 一格读数都画不出来时，空态浮层出的是哪一句。 */
export interface BarEmptyState {
  isEmpty: boolean
  text: string
}

/**
 * 这一页装没装历史取数。
 * ⚠ 判据是「每一行的时序槽都被同步读取器原样退回来了」，不是「全都 error」：
 * 台账改名、相对窗写错、网络断也全是 error，说成「公开大屏不提供历史数据」
 * 等于把人指向一个不存在的原因。
 * @param view 这一块的取值结果
 */
export function historyUnavailable(view: BarChartView): boolean {
  return (
    view.series.length > 0 &&
    view.series.every(
      (series) => series.state === 'error' && series.message === SYNC_REFUSAL,
    )
  )
}

/**
 * 空态口径。
 * ⚠ 「历史序列在这一页根本取不到」排在自定义文案**之前**：`emptyText` 的清单缺省
 * 是 `BAR_EMPTY_TEXT`，渲染前必被铺上，专用那一句排在它后面就永远出不来。
 * @param config 该节点落库的配置
 * @param view 这一块的取值结果
 */
export function emptyStateOf(
  config: Record<string, unknown>,
  view: BarChartView,
): BarEmptyState {
  const drawn = view.series.some((series) =>
    series.data.some((value) => value !== null),
  )
  if (drawn) return { isEmpty: false, text: '' }
  if (historyUnavailable(view)) {
    return { isEmpty: true, text: BAR_HISTORY_EMPTY_TEXT }
  }
  return {
    isEmpty: true,
    text: readTrimmedText(config.emptyText) || BAR_EMPTY_TEXT,
  }
}

/**
 * 图区的读屏摘要：canvas 里的一切对读屏是纯空白，只能挂一段文本。
 * ⚠ 一行都没配来源时给空串——`aria-label=""` 会把图区读成一个没名字的图形，
 * 比什么都不写更糟，壳据此把整个属性省掉。
 * ⚠ 没读数的那几行也报出来：图例可以被关掉，而读屏这一面是关不掉的。
 * @param config 该节点落库的配置
 * @param view 这一块的取值结果
 */
export function ariaSummaryOf(
  config: Record<string, unknown>,
  view: BarChartView,
): string {
  if (view.series.length === 0) return ''
  const format = readBarFormat(config)
  const drawn = view.series.filter((series) =>
    series.data.some((value) => value !== null),
  )
  const blank = view.series.filter(
    (series) => !series.data.some((value) => value !== null),
  )
  const parts = drawn.map((series) => {
    const numbers = series.data.filter(
      (value): value is number => value !== null,
    )
    const last = numbers[numbers.length - 1] ?? null
    return `${series.legendName} 末值 ${cellText(last, series.item, format)}`
  })
  const head =
    drawn.length === 0
      ? '对比柱图，一根柱都画不出来'
      : `对比柱图，共 ${String(drawn.length)} 组、${String(view.categories.length)} 个类目：${parts.join('；')}`
  if (blank.length === 0) return head
  const names = blank.map((series) => series.legendName).join('、')
  return `${head}；另有 ${String(blank.length)} 组没有读数：${names}`
}

/**
 * 绑点面板上每一行叫什么：名字给人看，联动值给人核对。
 * ⚠ 没起名的那几行在墙上不画标签，但在绑点面板上仍得有个称呼——十几行全靠数
 * 行号认对象，是这套面板最容易接错的地方。
 * @param config 该节点落库的配置
 */
export function barRowLabels(
  config: Record<string, unknown>,
): Record<string, { title: string; id: string }> {
  const labels: Record<string, { title: string; id: string }> = {}
  const seen = new Map<string, number>()
  readBarItems(config[BAR_ITEMS_KEY]).forEach((item, index) => {
    const title = displayName(item, index, seen)
    for (const field of [BAR_VALUE_FIELD, BAR_SERIES_FIELD]) {
      labels[barFieldKey(index, field)] = { title, id: item.name }
    }
  })
  return labels
}

/**
 * 每个数组槽应有几行。
 * ⚠ 一行都没有时也要给 0，别把键漏掉：漏掉的槽会被绑点面板当成「行由用户手工
 * 增删」，于是摆出一个加了也永远喂不到东西的「新增一行」。
 * @param config 该节点落库的配置
 */
export function barRowCounts(
  config: Record<string, unknown>,
): Record<string, number> {
  return { [BAR_SLOT_KEY]: readBarItems(config[BAR_ITEMS_KEY]).length }
}
