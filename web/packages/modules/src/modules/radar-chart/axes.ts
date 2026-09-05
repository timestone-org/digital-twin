/**
 * @fileoverview radar-chart 一整块的取值：槽键与 `fieldKey`、指标列表的归一化、
 * 逐轴四档状态、一根轴能不能画的判据、对比组画不画得全，以及空态那几句，
 * 最后收成一份纯数据的 `AxisView[]`。纯函数，不碰 DOM 也不碰 echarts。
 *
 * ⚠ 四档在注入袋里长得一模一样（键都不存在），全靠 `meta.slots` 分开：合成一档的
 * 代价是「还没绑」与「取不到」在墙上是同一根空轴（DASHBOARD_DESIGN §4.3）。
 * ⚠ 状态按**清单声明的子槽**逐一去问，不按 `slots` 的键遍历：设计态走
 * `previewBindings` 那条路，`slots` 里会多出模块自己不认识的键。
 * ⚠ 画不出来的那根轴**整根不进轮子**，不是喂一个空值占着位置：echarts 的雷达
 * 把 `null` / `NaN` / `'-'` / `undefined` 一律落在圆心（实测四种写法出的 SVG 路径
 * 与喂 0 逐字节相同），那在图上是一个真实的凹陷，看图的人读不出「这根轴配错了」。
 * 剔掉的那几根改由图例逐条交代原因，见 `option.ts`。
 * ⚠ 本组与对比组共用同一套逐轴量程：量程写在 `indicator` 上，两组各归一各的话
 * 同一个长度在两组里代表不同的数，形状之间就没法比了。
 */
import type { ModuleSlotMeta } from '@dt/contracts'

import { valueText } from '../../shared/chart/chartKit'
import {
  readArray,
  readLooseNumber,
  readNumber,
  readRecord,
  readText,
  readTrimmedText,
} from '../../shared/config'
import { isPresent } from '../../shared/format'
import { cellState, type CellState } from '../../shared/slotState'
import {
  RADAR_AXIS_MAX_DEFAULT,
  RADAR_AXIS_MIN_DEFAULT,
  RADAR_MIN_AXES,
} from './options'

/**
 * 逐轴读数的数组绑定槽键。
 * ⚠ 清单与渲染两处都从这里取，不许各写一遍字面量：拼错的那一份既不报错也永远取不到值。
 */
export const AXIS_SLOT_KEY = 'axisValues'

/** 指标（雷达的轴）列表的配置键。 */
export const AXIS_ITEMS_KEY = 'indicators'

/** 本组读数的子槽名。 */
export const AXIS_VALUE_FIELD = 'value'

/** 对比组读数的子槽名；留空是常态，那时整条对比组不进 option。 */
export const AXIS_COMPARE_FIELD = 'compare'

/** 一行上的两个子槽。 */
export type AxisSlotField = typeof AXIS_VALUE_FIELD | typeof AXIS_COMPARE_FIELD

/** 整块空态的兜底文案；用户把「空态文案」清空时也用它。 */
export const RADAR_EMPTY_TEXT = '暂无数据'

/** 画得出来的轴不够时的那一句，后面接上逐根轴的原因。 */
export const RADAR_TOO_FEW_TEXT = '可画的维度不足 3 根，雷达退化成线段'

/** 两组的出厂称呼。 */
export const SERIES_NAME_DEFAULT = '本组'
export const COMPARE_NAME_DEFAULT = '对比组'

/** 没有名称的那根轴在图上的称呼。 */
const UNNAMED_PREFIX = '第 '
const UNNAMED_SUFFIX = ' 轴'

/** 整块缺省小数位，与 `unitPrecisionFields()` 的 help 同口径。 */
const DEFAULT_PRECISION = 2

/**
 * 一根轴没进轮子的原因。
 * ⚠ 五条各说各的：并成一句「无数据」的代价是「量程填反了」与「点位断了」在图例上
 * 看着一模一样，而这两件事一件改配置、一件跑现场。
 */
export const AXIS_NOTES = {
  noRange: '量程未配',
  badRange: '量程配错',
  pending: '等首帧',
  error: '取不到',
  missing: '无读数',
} as const

/** 对比组整条画不全的原因。 */
export const COMPARE_NOTES = {
  pending: '等首帧',
  error: '取不到',
  missing: '缺读数',
} as const

/** 归一化后的一根轴的配置。 */
export interface AxisItem {
  /** ⚠ 空串 = 这根轴没起名，图上按「第 N 轴」称呼它。 */
  name: string
  /** 逐轴量程的下界；`null` = 没配出一个有限数。 */
  min: number | null
  /** 逐轴量程的上界；`null` = 没配出一个有限数。 */
  max: number | null
  /** ⚠ 不 trim：`'° C'` 这类带空格是用户显式的排版意图。 */
  unit: string
  /** 留空 = 跟随整块的小数位。 */
  precision: number | null
}

/** 一根轴可归一的量程。 */
export interface AxisRange {
  min: number
  max: number
}

/** 一根轴要画的全部东西。 */
export interface AxisView {
  /** 文档序下标，取绑定槽用它。 */
  index: number
  /** 本组那个子槽此刻处在哪一档。 */
  state: CellState
  /** 对比组那个子槽此刻处在哪一档。 */
  compareState: CellState
  /** 轮子上的轴名，同名时按出现序去重。 */
  name: string
  /** 图例上的名字 = 轴名 +（原因）；进得了轮子的那几根用不上它。 */
  legendName: string
  /** 没进轮子的原因；空串 = 正常。 */
  note: string
  /** 可归一的量程；`null` = 这根轴不可归一。 */
  range: AxisRange | null
  /** 本组读数原值；`null` = 没读数。 */
  value: number | null
  /** 对比组读数原值；`null` = 没读数。 */
  compare: number | null
  /** 这根轴自己的单位，空串则跟随整块。 */
  unit: string
  /** 这根轴自己的小数位，`null` 则跟随整块。 */
  precision: number | null
}

/** 进了轮子的那几根轴：量程与本组读数都已确定。 */
export interface DrawnAxis extends AxisView {
  range: AxisRange
  value: number
}

/** 整块共用的数值口径。 */
export interface RadarFormat {
  unit: string
  precision: number
}

/** 两组的称呼。 */
export interface GroupNames {
  series: string
  compare: string
}

/** 组装一整块要用到的输入。 */
export interface AxisViewsInput {
  config: Record<string, unknown>
  /** `values[AXIS_SLOT_KEY]` 的原值，正常是一个逐轴的数组。 */
  rows: unknown
  /** `meta.slots`；缺席表示运行时没下发逐槽结论（设计态与独立挂载）。 */
  slots: Readonly<Record<string, ModuleSlotMeta>> | undefined
}

/**
 * 第 index 根轴第 field 个子槽的 `fieldKey`。
 * ⚠ index 是**归一化输出**里的文档序：派生绑定行与读值必须喂同一份列表。
 * @param index 归一化后的下标
 * @param field 子槽名
 */
export function axisFieldKey(index: number, field: AxisSlotField): string {
  return `${AXIS_SLOT_KEY}[${index}].${field}`
}

/**
 * 把配置里的一行规整成一根轴。缺什么补什么，不丢行。
 * ⚠ 脏行不丢、只补默认：丢一行会让它之后每一条绑定改喂另一根轴，而绑定的
 * `fieldKey` 是按下标拼的。
 * @param raw 配置数组里的一行
 */
function toItem(raw: unknown): AxisItem {
  const row = readRecord(raw)
  return {
    name: readTrimmedText(row.name),
    min: readLooseNumber(row.min),
    max: readLooseNumber(row.max),
    unit: readText(row.unit),
    precision: readLooseNumber(row.precision),
  }
}

/**
 * 指标列表的归一化。
 * @param raw `config[AXIS_ITEMS_KEY]` 的原值
 */
export function readAxisItems(raw: unknown): AxisItem[] {
  return readArray(raw).map(toItem)
}

/**
 * 整块的单位与小数位。
 * @param config 该节点落库的配置
 */
export function readRadarFormat(config: Record<string, unknown>): RadarFormat {
  return {
    unit: readText(config.unit),
    precision: readNumber(config.precision, DEFAULT_PRECISION),
  }
}

/**
 * 两组各叫什么；留空回落到出厂称呼。
 * ⚠ 名字不许留空：图例名同时是这一条 series 的 `name`，空串在 echarts 那边
 * 认领不到任何图例项，整条状态就没地方说话了。
 * @param config 该节点落库的配置
 */
export function readGroupNames(config: Record<string, unknown>): GroupNames {
  return {
    series: readTrimmedText(config.seriesName) || SERIES_NAME_DEFAULT,
    compare: readTrimmedText(config.compareName) || COMPARE_NAME_DEFAULT,
  }
}

/**
 * 这根轴的量程可归一吗。
 * ⚠ `max <= min` 一律判不可归一，而不是夹到 0：夹出来的那个 0 在雷达上是一个
 * 真实的凹陷，看图的人读成「这个指标很差」，而实际上是量程填反了。
 * @param item 归一化后的这根轴
 */
function rangeOf(item: AxisItem): AxisRange | null {
  const { min, max } = item
  if (min === null || max === null) return null
  return max > min ? { min, max } : null
}

/**
 * 这根轴没进轮子的原因；进得去给空串。
 * ⚠ 量程先判：量程是配置错，自己不会好；而「等首帧」再等一会儿就有了。两件事
 * 同时成立时报量程，看的人才知道该去改哪里。
 * @param item 归一化后的这根轴
 * @param range 可归一的量程，`null` = 不可归一
 * @param state 本组那个子槽所在的档
 * @param raw 注入袋里本组的原值
 */
function noteOf(
  item: AxisItem,
  range: AxisRange | null,
  state: CellState,
  raw: unknown,
): string {
  if (range === null) {
    return item.min === null || item.max === null
      ? AXIS_NOTES.noRange
      : AXIS_NOTES.badRange
  }
  if (state === 'pending') return AXIS_NOTES.pending
  if (state === 'error') return AXIS_NOTES.error
  return isPresent(raw) ? '' : AXIS_NOTES.missing
}

/** 取第 index 行某个子槽注入的原值；没有这一行给 undefined。 */
function rawAt(
  rows: readonly unknown[],
  index: number,
  field: AxisSlotField,
): unknown {
  const row = rows[index]
  return row === undefined ? undefined : readRecord(row)[field]
}

/**
 * 轴名：没起名的按「第 N 轴」称呼，同名的按出现序加后缀去重。
 * ⚠ 不去重的代价是图例上同名的两条被并成一条，而剔掉的那几根轴各有各的原因——
 * 少的那一条没有任何报错。
 * @param item 归一化后的这根轴
 * @param index 文档序下标
 * @param seen 已出现过的名字与它出现的次数
 */
function displayName(
  item: AxisItem,
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
 * 一整块的轴。
 * ⚠ 本组那个子槽「没配来源」的那几根轴整根不进输出：图例也不列它们——一块摆了
 * 8 个指标的雷达，图例上挂着 5 条从没接过点位的空名字，比少画它们更难看懂。
 * ⚠ 对比组只在轴层面记一个档：它画不画得全是整条的事，由 `buildCompareGroup` 定。
 * @param input 配置、注入袋与逐槽结论
 */
export function buildAxisViews(input: AxisViewsInput): AxisView[] {
  const rows = readArray(input.rows)
  const hasSlots = input.slots !== undefined
  const seen = new Map<string, number>()
  const views: AxisView[] = []
  readAxisItems(input.config[AXIS_ITEMS_KEY]).forEach((item, index) => {
    const raw = rawAt(rows, index, AXIS_VALUE_FIELD)
    const rawCompare = rawAt(rows, index, AXIS_COMPARE_FIELD)
    const slots = input.slots
    const state = cellState(
      slots?.[axisFieldKey(index, AXIS_VALUE_FIELD)],
      raw,
      hasSlots,
    )
    const name = displayName(item, index, seen)
    if (state === 'unbound') return
    const range = rangeOf(item)
    const note = noteOf(item, range, state, raw)
    views.push({
      index,
      state,
      compareState: cellState(
        slots?.[axisFieldKey(index, AXIS_COMPARE_FIELD)],
        rawCompare,
        hasSlots,
      ),
      name,
      legendName: note === '' ? name : `${name}（${note}）`,
      note,
      range,
      value: note === '' && isPresent(raw) ? raw : null,
      compare: isPresent(rawCompare) ? rawCompare : null,
      unit: item.unit,
      precision: item.precision,
    })
  })
  return views
}

/**
 * 进得了轮子的那几根轴，保持文档序。
 * @param views 这一块的全部轴
 */
export function drawnAxes(views: readonly AxisView[]): DrawnAxis[] {
  return views.filter(
    (view): view is DrawnAxis =>
      view.note === '' && view.range !== null && view.value !== null,
  )
}

/**
 * 被剔出轮子的那几根轴，保持文档序。它们只在图例上露面。
 * @param views 这一块的全部轴
 */
export function notedAxes(views: readonly AxisView[]): AxisView[] {
  return views.filter((view) => view.note !== '')
}

/**
 * 一根轴与它上面的一个读数。
 * ⚠ 轴与值在**构造处**就配好对，之后一路带着走：换成「两个等长数组按下标配对」的话，
 * 一旦哪一头少一项，读数就会整体错位到相邻那根轴上，而两边都不报错。
 */
export interface AxisReading {
  axis: DrawnAxis
  value: number
}

/** 对比组整条的结论。 */
export interface CompareGroup {
  /** 一根轴上都没配过对比来源：整条不进 option，图例也不列。 */
  isConfigured: boolean
  /** 没进轮子的原因；空串 = 整条画得出来。 */
  note: string
  /** 逐轴配好对的读数；画不全时是空数组。 */
  readings: AxisReading[]
}

/**
 * 对比组画不画得出来。
 * ⚠ 只要有一根画出来的轴缺对比读数，整条就不画：雷达的多边形没法跳过某一个顶点
 * （实测喂 `null` 与喂 0 出的路径逐字节相同），补一个数就是在图上凭空造一个凹陷。
 * ⚠ 原因取最该先看的那一条：取不到 > 等首帧 > 缺读数。前两条是现场的事，
 * 最后一条是还没绑完。
 * @param axes 进了轮子的那几根轴
 */
export function buildCompareGroup(axes: readonly DrawnAxis[]): CompareGroup {
  const states = axes.map((axis) => axis.compareState)
  if (axes.length === 0 || states.every((state) => state === 'unbound')) {
    return { isConfigured: false, note: '', readings: [] }
  }
  const paired = axes.flatMap((axis) =>
    isPresent(axis.compare) ? [{ axis, value: axis.compare }] : [],
  )
  const note = compareNoteOf(states, paired.length === axes.length)
  return {
    isConfigured: true,
    note,
    readings: note === '' ? paired : [],
  }
}

/**
 * 本组逐轴配好对的读数。
 * @param axes 进了轮子的那几根轴
 */
export function ownReadings(axes: readonly DrawnAxis[]): AxisReading[] {
  return axes.map((axis) => ({ axis, value: axis.value }))
}

/**
 * 对比组画不全时该说哪一句。
 * @param states 逐轴对比子槽所在的档
 * @param isComplete 每一根画出来的轴上都有读数没有
 */
function compareNoteOf(
  states: readonly CellState[],
  isComplete: boolean,
): string {
  if (states.includes('error')) return COMPARE_NOTES.error
  if (states.includes('pending')) return COMPARE_NOTES.pending
  return isComplete ? '' : COMPARE_NOTES.missing
}

/**
 * 值签名：只含画得出来的那几样，实时值一变它就变。
 * ⚠ 它是 `ChartShell` 的 `watchValues` 的返回值，配 `valuesDeep: false` 用——
 * 传解包后的整袋值会让每根轴的两个读数被逐键深度遍历。
 * @param views 这一块的全部轴
 */
export function signatureOf(views: readonly AxisView[]): string {
  return views
    .map(
      (view) =>
        `${String(view.index)}:${view.state}:${view.compareState}:${view.note}` +
        `:${String(view.value)}:${String(view.compare)}`,
    )
    .join('␟')
}

/** 空态浮层此刻要不要出，以及出的是哪一句。 */
export interface RadarEmptyState {
  isEmpty: boolean
  text: string
}

/**
 * 空态口径。
 * ⚠ 「一根都没绑」与「绑了但画不出三根」是两回事，各说各的：前者去配绑定，
 * 后者要么补指标要么去修那几根轴，把原因逐条挂在后面才知道该修哪个。
 * @param config 该节点落库的配置
 * @param views 这一块的全部轴
 */
export function emptyStateOf(
  config: Record<string, unknown>,
  views: readonly AxisView[],
): RadarEmptyState {
  if (drawnAxes(views).length >= RADAR_MIN_AXES) {
    return { isEmpty: false, text: '' }
  }
  if (views.length === 0) {
    return {
      isEmpty: true,
      text: readTrimmedText(config.emptyText) || RADAR_EMPTY_TEXT,
    }
  }
  const noted = notedAxes(views)
  if (noted.length === 0) return { isEmpty: true, text: RADAR_TOO_FEW_TEXT }
  const reasons = noted.map((view) => view.legendName).join('；')
  return { isEmpty: true, text: `${RADAR_TOO_FEW_TEXT}：${reasons}` }
}

/**
 * 绑点面板上每一行叫什么：名字给人看，联动值给人核对。
 * ⚠ 键是这一行**第一个**子槽的 `fieldKey`（`ModuleManifest.bindingRowLabels`），
 * 对比组那个子槽跟着同一行走，不另起一条。
 * @param config 该节点落库的配置
 */
export function axisRowLabels(
  config: Record<string, unknown>,
): Record<string, { title: string; id: string }> {
  const labels: Record<string, { title: string; id: string }> = {}
  const seen = new Map<string, number>()
  readAxisItems(config[AXIS_ITEMS_KEY]).forEach((item, index) => {
    labels[axisFieldKey(index, AXIS_VALUE_FIELD)] = {
      title: displayName(item, index, seen),
      id: item.name,
    }
  })
  return labels
}

/**
 * 每个数组槽应有几行。
 * ⚠ 一根轴都没有时也要给 0，别把键漏掉：漏掉的槽会被绑点面板当成「行由用户手工
 * 增删」，于是摆出一个加了也永远喂不到东西的「新增一行」。
 * @param config 该节点落库的配置
 */
export function axisRowCounts(
  config: Record<string, unknown>,
): Record<string, number> {
  return { [AXIS_SLOT_KEY]: readAxisItems(config[AXIS_ITEMS_KEY]).length }
}

/** 出厂量程，清单与用例共用这一对。 */
export const AXIS_DEFAULT_RANGE: AxisRange = {
  min: RADAR_AXIS_MIN_DEFAULT,
  max: RADAR_AXIS_MAX_DEFAULT,
}

/**
 * 一根轴上某个读数的文案：逐轴单位与小数位优先，缺了才用整块那一份。
 * @param value 读数原值
 * @param view 这根轴
 * @param format 整块的数值口径
 */
export function axisText(
  value: number,
  view: AxisView,
  format: RadarFormat,
): string {
  return valueText(
    value,
    view.precision ?? format.precision,
    view.unit || format.unit,
  )
}

/**
 * 逐轴列出一组的读数。
 * @param readings 逐轴配好对的读数
 * @param format 整块的数值口径
 */
function readingsOf(
  readings: readonly AxisReading[],
  format: RadarFormat,
): string {
  return readings
    .map(
      (item) => `${item.axis.name} ${axisText(item.value, item.axis, format)}`,
    )
    .join('；')
}

/**
 * 对比组在读屏摘要里的那一段；没配来源时整段不出。
 * @param compare 对比组整条的结论
 * @param name 对比组的称呼
 * @param format 整块的数值口径
 */
function compareSummary(
  compare: CompareGroup,
  name: string,
  format: RadarFormat,
): string {
  if (!compare.isConfigured) return ''
  if (compare.note !== '') return `；${name}（${compare.note}）`
  return `；${name}：${readingsOf(compare.readings, format)}`
}

/**
 * 图区的读屏摘要：canvas 里的一切对读屏是纯空白，只能挂一段文本。
 * ⚠ 一根轴都没配来源时给空串——`aria-label=""` 会把图区读成一个没名字的图形，
 * 比什么都不写更糟，壳据此把整个属性省掉。
 * ⚠ 被剔出轮子的那几根也报出来：图例可以被关掉，而读屏这一面是关不掉的。
 * @param config 该节点落库的配置
 * @param views 这一块的全部轴
 */
export function ariaSummaryOf(
  config: Record<string, unknown>,
  views: readonly AxisView[],
): string {
  if (views.length === 0) return ''
  const format = readRadarFormat(config)
  const names = readGroupNames(config)
  const axes = drawnAxes(views)
  const head =
    axes.length === 0
      ? '多维雷达，一根轴都画不出来'
      : `多维雷达，${names.series}共 ${String(axes.length)} 根轴：` +
        readingsOf(ownReadings(axes), format)
  const tail = compareSummary(buildCompareGroup(axes), names.compare, format)
  const noted = notedAxes(views)
  if (noted.length === 0) return `${head}${tail}`
  const blank = noted.map((view) => view.legendName).join('、')
  return `${head}${tail}；另有 ${String(noted.length)} 根轴画不出来：${blank}`
}
