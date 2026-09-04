/**
 * @fileoverview pie-chart 一整块的取值：槽键与 `fieldKey`、扇区列表的归一化、
 * 逐片四档状态、能不能画成扇形的判据、按当前可画的那几片归一出的占比，
 * 以及空态那两句与点一片上抛的值，最后收成一份纯数据的 `SliceView[]`。
 * 纯函数，不碰 DOM 也不碰 echarts。
 *
 * ⚠ 四档在注入袋里长得一模一样（键都不存在），全靠 `meta.slots` 分开：合成一档的
 * 代价是「还没绑」与「取不到」在墙上是同一片空白（DASHBOARD_DESIGN §4.3）。
 * ⚠ 状态按**清单声明的子槽**逐一去问，不按 `slots` 的键遍历：设计态走
 * `previewBindings` 那条路，`slots` 里会多出模块自己不认识的键。
 * ⚠ 负值在饼图上没有几何意义——扇形只有面积没有方向。取绝对值会让「-30」与「30」
 * 画成同一片，占比也跟着错；所以整片剔除并在图例上说明，不进分母。
 * ⚠ 占比只按**当前 ok 的那几片**归一：取不到的那一片不进分母，否则接了 2 片的
 * 环图会画成两小条加一大块空白，而空白并不代表任何一个量。
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
import { fmtTrim, isPresent } from '../../shared/format'
import { cellState, type CellState } from '../../shared/slotState'

/**
 * 扇区数值的数组绑定槽键。
 * ⚠ 清单与渲染两处都从这里取，不许各写一遍字面量：拼错的那一份既不报错也永远取不到值。
 */
export const SLICE_SLOT_KEY = 'sliceValues'

/** 扇区列表的配置键。 */
export const SLICE_ITEMS_KEY = 'slices'

/** 一片只有一个子槽：数值。占比由前端归一，不从点位来。 */
export const SLICE_VALUE_FIELD = 'value'

/** 整块空态的兜底文案；用户把「空态文案」清空时也用它。 */
export const PIE_EMPTY_TEXT = '暂无数据'

/** 读数都是 0 时的那一句：有读数，但没有分母，一片也画不出来。 */
export const PIE_ZERO_TEXT = '读数合计为 0，画不出占比'

/** 没有名称的那一片在图例上的称呼。 */
const UNNAMED_PREFIX = '第 '
const UNNAMED_SUFFIX = ' 片'

/** 占比固定一位小数：两位在图例里读不出差别，只会把名字挤掉。 */
const SHARE_DIGITS = 1

/** 整块缺省小数位，与 `unitPrecisionFields()` 的 help 同口径。 */
const DEFAULT_PRECISION = 2

/**
 * 一片没进扇区时挂在图例名后面的后缀。
 * ⚠ 四条各说各的原因：并成一句「无数据」的代价是「还没到首帧」与「表被删了」
 * 在图例上看着一模一样。
 */
export const SLICE_NOTES = {
  pending: '等首帧',
  error: '取不到',
  missing: '无读数',
  negative: '负值不计',
} as const

/** 归一化后的一片的配置。 */
export interface SliceItem {
  /** ⚠ 空串 = 这一片没起名，图例上按「第 N 片」称呼它。 */
  name: string
  /** 逐片固定色，填了就压过色板；只填 `var(--…)` 引用才跟着换肤走。 */
  color: string
  /** ⚠ 不 trim：`'° C'` 这类带空格是用户显式的排版意图。 */
  unit: string
  /** 留空 = 跟随整块的小数位。 */
  precision: number | null
}

/** 一片要画的全部东西。 */
export interface SliceView {
  /** 文档序下标，取绑定槽与取色板都用它。 */
  index: number
  state: CellState
  /** 图例与扇区上的名字，同名时按出现序去重。 */
  legendName: string
  /** 点这一片上抛的联动值 = 配置里写的名称；空串 = 这一片点了不上抛。 */
  emitValue: string
  /** 没进扇区的原因；空串 = 正常。 */
  note: string
  /**
   * 读数；`null` = 画不成扇形：状态不是 ok、没有读数，或者是个负值。
   * ⚠ `null` 的那几片仍然要进 `series.data`（占着自己的位置、不进分母），
   * 否则图例上那一条连图元都建不起来。
   */
  value: number | null
  /** 占比（0–100），按当前可画的那几片归一；`null` = 分母为 0 算不出。 */
  share: number | null
  /** 逐片固定色的原文，空串 = 交给色板。 */
  color: string
  /** 读数 + 单位；`null` 值给空串。 */
  text: string
  /** 占比文案，形如 `42.5%`；算不出给空串。 */
  shareText: string
}

/** 整块共用的数值口径。 */
export interface PieFormat {
  unit: string
  precision: number
}

/** 组装一整块要用到的输入。 */
export interface SliceViewsInput {
  config: Record<string, unknown>
  /** `values[SLICE_SLOT_KEY]` 的原值，正常是一个扇区数组。 */
  rows: unknown
  /** `meta.slots`；缺席表示运行时没下发逐槽结论（设计态与独立挂载）。 */
  slots: Readonly<Record<string, ModuleSlotMeta>> | undefined
}

/**
 * 第 index 片那个子槽的 `fieldKey`。
 * ⚠ index 是**归一化输出**里的文档序：派生绑定行与读值必须喂同一份列表。
 * @param index 归一化后的下标
 */
export function sliceFieldKey(index: number): string {
  return `${SLICE_SLOT_KEY}[${index}].${SLICE_VALUE_FIELD}`
}

/**
 * 把配置里的一行规整成一片。缺什么补什么，不丢行。
 * ⚠ 脏行不丢、只补默认：丢一行会让它之后每一条绑定改喂另一片，而绑定的
 * `fieldKey` 是按下标拼的。
 * @param raw 配置数组里的一行
 */
function toItem(raw: unknown): SliceItem {
  const row = readRecord(raw)
  return {
    name: readTrimmedText(row.name),
    color: readTrimmedText(row.color),
    unit: readText(row.unit),
    precision: readLooseNumber(row.precision),
  }
}

/**
 * 扇区列表的归一化。
 * @param raw `config[SLICE_ITEMS_KEY]` 的原值
 */
export function readSliceItems(raw: unknown): SliceItem[] {
  return readArray(raw).map(toItem)
}

/**
 * 整块的单位与小数位。
 * @param config 该节点落库的配置
 */
export function readPieFormat(config: Record<string, unknown>): PieFormat {
  return {
    unit: readText(config.unit),
    precision: readNumber(config.precision, DEFAULT_PRECISION),
  }
}

/**
 * 这一片没进扇区的原因；进得去给空串。
 * @param state 这一片所在的档
 * @param raw 注入袋里这一片的原值
 */
function noteOf(state: CellState, raw: unknown): string {
  if (state === 'pending') return SLICE_NOTES.pending
  if (state === 'error') return SLICE_NOTES.error
  if (!isPresent(raw)) return SLICE_NOTES.missing
  return raw < 0 ? SLICE_NOTES.negative : ''
}

/** 取第 index 片注入的原值；没有这一行给 undefined。 */
function rawAt(rows: readonly unknown[], index: number): unknown {
  const row = rows[index]
  return row === undefined ? undefined : readRecord(row)[SLICE_VALUE_FIELD]
}

/**
 * 图例上的名字：没起名的按「第 N 片」称呼，同名的按出现序加后缀去重。
 * ⚠ 不去重的代价是 echarts 把同名的两片并成一条图例，而两片的值仍各画各的——
 * 图例上少一行，且没有任何报错。
 * @param item 归一化后的这一片
 * @param index 文档序下标
 * @param seen 已出现过的名字与它出现的次数
 */
function displayName(
  item: SliceItem,
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

/** 一片的读数文案：逐片单位与小数位优先，缺了才用整块那一份。 */
function textOf(
  value: number | null,
  item: SliceItem,
  format: PieFormat,
): string {
  if (value === null) return ''
  return valueText(
    value,
    item.precision ?? format.precision,
    item.unit || format.unit,
  )
}

/** 归一化前的一片：状态与读数已定，占比还没算。 */
interface RawSlice {
  index: number
  state: CellState
  legendName: string
  note: string
  value: number | null
  item: SliceItem
}

/**
 * 逐片问一次状态与读数。
 * ⚠ 「没配来源」的那几片整片不进输出：图例也不列它们——一块摆了 6 片的环图，
 * 图例上挂着 4 条从没接过点位的空名字，比少画它们更难看懂。
 * @param items 归一化后的扇区列表
 * @param input 配置、注入袋与逐槽结论
 */
function collect(
  items: readonly SliceItem[],
  input: SliceViewsInput,
): RawSlice[] {
  const rows = readArray(input.rows)
  const hasSlots = input.slots !== undefined
  const seen = new Map<string, number>()
  const found: RawSlice[] = []
  items.forEach((item, index) => {
    const raw = rawAt(rows, index)
    const state = cellState(input.slots?.[sliceFieldKey(index)], raw, hasSlots)
    const name = displayName(item, index, seen)
    if (state === 'unbound') return
    const note = noteOf(state, raw)
    found.push({
      index,
      state,
      legendName: note === '' ? name : `${name}（${note}）`,
      note,
      value: note === '' && isPresent(raw) ? raw : null,
      item,
    })
  })
  return found
}

/**
 * 一整块的扇区。
 * @param input 配置、注入袋与逐槽结论
 */
export function buildSliceViews(input: SliceViewsInput): SliceView[] {
  const format = readPieFormat(input.config)
  const raws = collect(readSliceItems(input.config[SLICE_ITEMS_KEY]), input)
  const total = raws.reduce((sum, raw) => sum + (raw.value ?? 0), 0)
  return raws.map((raw) => {
    const share =
      raw.value === null || total <= 0 ? null : (raw.value / total) * 100
    return {
      index: raw.index,
      state: raw.state,
      legendName: raw.legendName,
      emitValue: raw.item.name,
      note: raw.note,
      value: raw.value,
      share,
      color: raw.item.color,
      text: textOf(raw.value, raw.item, format),
      shareText: share === null ? '' : `${fmtTrim(share, SHARE_DIGITS)}%`,
    }
  })
}

/**
 * 值签名：只含画得出来的那几样，实时值一变它就变。
 * ⚠ 它是 `ChartShell` 的 `watchValues` 的返回值，配 `valuesDeep: false` 用——
 * 传解包后的整袋值会让 6 片 × 每秒一帧被逐键深度遍历。
 * @param views 这一块的全部扇区
 */
export function signatureOf(views: readonly SliceView[]): string {
  return views
    .map(
      (view) =>
        `${String(view.index)}:${view.state}:${view.note}:${String(view.value)}`,
    )
    .join('␟')
}

/**
 * 图区的读屏摘要：canvas 里的一切对读屏是纯空白，只能挂一段文本。
 * ⚠ 一片都没配来源时给空串——`aria-label=""` 会把图区读成一个没名字的图形，
 * 比什么都不写更糟，壳据此把整个属性省掉。
 * ⚠ 没读数的那几片也报出来：图例可以被关掉，而读屏这一面是关不掉的。
 * @param views 这一块的全部扇区
 */
export function ariaSummaryOf(views: readonly SliceView[]): string {
  if (views.length === 0) return ''
  const drawn = views.filter((view) => view.value !== null)
  const blank = views.filter((view) => view.value === null)
  const parts = drawn.map(
    (view) =>
      `${view.legendName} ${view.text}${view.shareText === '' ? '' : ` 占比 ${view.shareText}`}`,
  )
  const head =
    drawn.length === 0
      ? '构成环图，一片都画不出来'
      : `构成环图，共 ${String(drawn.length)} 片：${parts.join('；')}`
  if (blank.length === 0) return head
  const names = blank.map((view) => view.legendName).join('、')
  return `${head}；另有 ${String(blank.length)} 片没有读数：${names}`
}

/** 空态浮层此刻要不要出，以及出的是哪一句。 */
export interface PieEmptyState {
  isEmpty: boolean
  text: string
}

/**
 * 空态口径。
 * ⚠ 「读数全是 0」与「一片都画不出来」是两回事，各说各的：0 是真读数，
 * 但占比没有分母，几何上画不出任何一片——不给一句话的话屏上是一块无解的空白。
 * @param config 该节点落库的配置
 * @param views 这一块的全部扇区
 */
export function emptyStateOf(
  config: Record<string, unknown>,
  views: readonly SliceView[],
): PieEmptyState {
  const numbers = views
    .map((view) => view.value)
    .filter((value): value is number => value !== null)
  if (numbers.length === 0) {
    return {
      isEmpty: true,
      text: readTrimmedText(config.emptyText) || PIE_EMPTY_TEXT,
    }
  }
  const total = numbers.reduce((sum, value) => sum + value, 0)
  return total > 0
    ? { isEmpty: false, text: '' }
    : { isEmpty: true, text: PIE_ZERO_TEXT }
}

/**
 * 绑点面板上每一片叫什么：名字给人看，联动值给人核对。
 * ⚠ 没起名的那几片在墙上不画标签，但在绑点面板上仍得有个称呼——十几行全靠数
 * 行号认对象，是这套面板最容易接错的地方。
 * @param config 该节点落库的配置
 */
export function sliceRowLabels(
  config: Record<string, unknown>,
): Record<string, { title: string; id: string }> {
  const labels: Record<string, { title: string; id: string }> = {}
  const seen = new Map<string, number>()
  readSliceItems(config[SLICE_ITEMS_KEY]).forEach((item, index) => {
    labels[sliceFieldKey(index)] = {
      title: displayName(item, index, seen),
      id: item.name,
    }
  })
  return labels
}

/**
 * 每个数组槽应有几行。
 * ⚠ 一片都没有时也要给 0，别把键漏掉：漏掉的槽会被绑点面板当成「行由用户手工
 * 增删」，于是摆出一个加了也永远喂不到东西的「新增一行」。
 * @param config 该节点落库的配置
 */
export function sliceRowCounts(
  config: Record<string, unknown>,
): Record<string, number> {
  return { [SLICE_SLOT_KEY]: readSliceItems(config[SLICE_ITEMS_KEY]).length }
}
