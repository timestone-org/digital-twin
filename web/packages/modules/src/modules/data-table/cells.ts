/**
 * @fileoverview data-table 一整块的取值：槽键与 `fieldKey`、列与行两份配置的归一化、
 * 逐格四档状态、命中值规则后的上色、表头与数据行共用的那一份列宽模板、行数截断，
 * 最后收成一份纯数据的 `TableView`。纯函数，不碰 DOM。
 *
 * ⚠ 四档在注入袋里长得一模一样（键都不存在），全靠 `meta.slots` 分开：合成一档的
 * 代价是「还没绑」与「取不到」在墙上是同一块空白（DASHBOARD_DESIGN §4.3）。
 * ⚠ 状态按**清单声明的子槽**逐一去问，不按 `slots` 的键遍历：设计态走
 * `previewBindings` 那条路，`slots` 里会多出模块自己不认识的键。
 * ⚠ 行的 `fieldKey` 按**下标**拼、列的按**列键**拼：于是调列的顺序不动任何绑定，
 * 而删掉中间一行会让它之后每一行的绑定都改喂前一行。两条不对称，文档里逐字写明。
 * ⚠ 表头与数据行的列宽只有 `columnsTemplateOf` 这一个来源：拆成两处字符串就会错列，
 * 而 typecheck 与 lint 都看不出问题。
 */
import type { ModuleSlotMeta } from '@dt/contracts'

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
import { fmtDecimal, isPresent, NO_DATA } from '../../shared/format'
import { cellState, reasonOf, type CellState } from '../../shared/slotState'
import {
  TABLE_ALIGN_VALUES,
  TABLE_COLUMN_KEY_VALUES,
  TABLE_FIRST_COLUMN_KEY,
  TABLE_MAX_ROWS_CAP,
  TABLE_PRECISION_MAX,
  TABLE_WIDTH_MAX,
  type TableAlign,
  type TableColumnKey,
} from './options'
import {
  evaluateTableRules,
  normalizeTableRules,
  TABLE_RULES_KEY,
  type TableRule,
} from './rules'

/**
 * 单元格读数的数组绑定槽键。
 * ⚠ 清单与渲染两处都从这里取，不许各写一遍字面量：拼错的那一份既不报错也永远取不到值。
 */
export const CELL_SLOT_KEY = 'cellValues'

/** 列配置的键。 */
export const TABLE_COLUMNS_KEY = 'columns'

/** 行配置的键。 */
export const TABLE_ROWS_KEY = 'rows'

export { TABLE_RULES_KEY } from './rules'

/** 整块空态的兜底文案；用户把「空态文案」清空时也用它。 */
export const TABLE_EMPTY_TEXT = '暂无数据'

/** 一列都没启用时的那一句：行配好了也画不出任何一格。 */
export const TABLE_NO_COLUMN_TEXT = '一列都没启用，先在「列」里挑一个列键'

/** 没起名的那一行在表头列里的称呼。 */
const UNNAMED_PREFIX = '第 '
const UNNAMED_SUFFIX = ' 行'

/** 整块缺省小数位。 */
const DEFAULT_PRECISION = 2

/** 行名列的缺省宽度占比（fr）。 */
const NAME_COLUMN_FR = 1.6

/**
 * 三档没有读数的格子各画一个记号。
 * ⚠ 三档共用一个「—」的代价是：现场断了的那一格与从没配过的那一格在墙上一模一样，
 * 而表格有的是地方，摆得下三个不同的记号。完整原因仍挂 `title`。
 */
export const CELL_MARKS: Record<Exclude<CellState, 'ok'>, string> = {
  unbound: NO_DATA,
  pending: '⋯',
  error: '✕',
}

/** 归一化后的一列。 */
export interface TableColumn {
  key: TableColumnKey
  /** 表头文案；空串 = 按列键称呼它。 */
  name: string
  /** ⚠ 不 trim：`'° C'` 这类带空格是用户显式的排版意图。 */
  unit: string
  /** 留空 = 跟随整块的小数位。 */
  precision: number | null
  align: TableAlign
  /** 定宽 px；`0` = 跟其余不定宽的列分剩下的地方。 */
  width: number
}

/** 一格要画的全部东西。 */
export interface TableCellView {
  /** `v-for` 的键 = 列键，一行之内唯一。 */
  key: string
  state: CellState
  /** 展示文本；非 `ok` 档是 `CELL_MARKS` 里的记号。 */
  text: string
  /** 鼠标停上去的一句话；正常且没命中规则时是空串。 */
  title: string
  align: TableAlign
  /** 命中规则给的颜色；空串 = 跟随整表。 */
  color: string
  blink: boolean
}

/** 一行要画的全部东西。 */
export interface TableRowView {
  /** `v-for` 的键 = 行名签名 + 出现序；⚠ 绝不用下标。 */
  key: string
  /** 文档序下标，取绑定槽用它。 */
  index: number
  /** 行名列上的文案。 */
  name: string
  /** 点这一行上抛的联动值 = 配置里写的行名；空串 = 这一行点了不上抛。 */
  emitValue: string
  cells: TableCellView[]
}

/** 空态浮层此刻要不要出，以及出的是哪一句。 */
export interface TableEmptyState {
  isEmpty: boolean
  text: string
}

/** 一整块表。 */
export interface TableView {
  columns: TableColumn[]
  rows: TableRowView[]
  /** 表头与数据行**共用**的那一份列宽模板。 */
  columnsTemplate: string
  /**
   * 摆在表下面的说明。
   * ⚠ 截断与重列都必须说出来：少画几行而不吭声，看的人会把它当成现场就这么多行。
   */
  notes: string[]
  empty: TableEmptyState
}

/** 组装一整块要用到的输入。 */
export interface TableViewsInput {
  config: Record<string, unknown>
  /** `values[CELL_SLOT_KEY]` 的原值，正常是一个行数组。 */
  rows: unknown
  /** `meta.slots`；缺席表示运行时没下发逐槽结论（设计态与独立挂载）。 */
  slots: Readonly<Record<string, ModuleSlotMeta>> | undefined
}

/**
 * 第 index 行第 column 列那个子槽的 `fieldKey`。
 * ⚠ index 是**归一化输出**里的文档序：派生绑定行与读值必须喂同一份列表。
 * @param index 归一化后的行下标
 * @param column 列键
 */
export function cellFieldKey(index: number, column: string): string {
  return `${CELL_SLOT_KEY}[${index}].${column}`
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}

/**
 * 把配置里的一行规整成一列；列键认不出的整条丢掉。
 * ⚠ 丢得起：列的 `fieldKey` 按**列键**拼，不按下标，丢一列不会让别的列改喂另一个子槽。
 * @param raw 配置数组里的一行
 */
function toColumn(raw: unknown): TableColumn | null {
  const row = readRecord(raw)
  const key = TABLE_COLUMN_KEY_VALUES.find((item) => item === row.key)
  if (key === undefined) return null
  const precision = readLooseNumber(row.precision)
  return {
    key,
    name: readTrimmedText(row.name),
    unit: readText(row.unit),
    precision:
      precision === null
        ? null
        : clamp(Math.round(precision), 0, TABLE_PRECISION_MAX),
    align: readEnum(row.align, TABLE_ALIGN_VALUES, 'right'),
    width: clamp(Math.round(readNumber(row.width, 0)), 0, TABLE_WIDTH_MAX),
  }
}

/** 列表归一化的结果：留下的列，以及因列键重复被丢掉几条。 */
export interface ColumnScan {
  columns: TableColumn[]
  /** ⚠ 只数重复的那几条；列键认不出的那几条另算，它们本来就不是一列。 */
  duplicated: number
}

/**
 * 列表的归一化：认不出列键的丢掉，列键重复的只留先声明的那一条。
 * ⚠ 重复的那几列读的是同一个子槽，并排画两条一模一样的数比丢掉更难懂；
 * 但丢了必须说出来，故这里把条数一并带出去写进 `notes`。
 * @param raw `config[TABLE_COLUMNS_KEY]` 的原值
 */
export function scanTableColumns(raw: unknown): ColumnScan {
  const seen = new Set<string>()
  const columns: TableColumn[] = []
  let duplicated = 0
  for (const row of readArray(raw)) {
    const column = toColumn(row)
    if (column === null) continue
    if (seen.has(column.key)) {
      duplicated += 1
      continue
    }
    seen.add(column.key)
    columns.push(column)
  }
  return { columns, duplicated }
}

/**
 * 列表的归一化，只要列。
 * @param raw `config[TABLE_COLUMNS_KEY]` 的原值
 */
export function readTableColumns(raw: unknown): TableColumn[] {
  return scanTableColumns(raw).columns
}

/**
 * 行列表的归一化：脏行不丢、只补默认。
 * ⚠ 丢一行会让它之后每一条绑定改喂前一行，而绑定的 `fieldKey` 是按下标拼的。
 * @param raw `config[TABLE_ROWS_KEY]` 的原值
 */
export function readTableRows(raw: unknown): string[] {
  return readArray(raw).map((row) => readTrimmedText(readRecord(row).name))
}

/**
 * 行名列上的称呼：没起名的按「第 N 行」称呼它。
 * @param name 配置里写的行名
 * @param index 文档序下标
 */
export function rowDisplayName(name: string, index: number): string {
  return name === ''
    ? `${UNNAMED_PREFIX}${String(index + 1)}${UNNAMED_SUFFIX}`
    : name
}

/**
 * `v-for` 的行键：行名签名 + 出现序。
 * ⚠ 用下标做键会让「删掉中间一行」变成「最后一行消失、其余全部错位」，而闸门
 * 只拦模板里写死的 `:key="index"`，在这里算出来的下标它看不见。
 * @param name 配置里写的行名
 * @param seen 已出现过的行名与它出现的次数
 */
function rowKey(name: string, seen: Map<string, number>): string {
  const count = seen.get(name) ?? 0
  seen.set(name, count + 1)
  return `${name}#${String(count)}`
}

/**
 * 有值那一档的展示文本。
 * ⚠ 小数位**补零**（`fmtDecimal` 而不是 `fmtTrim`）：一列里 91 与 91.9 并排出现时，
 * 小数点对不上，整列读起来像两个精度不同的表——而逐列对齐正是表格存在的理由。
 * ⚠ 认不出的值照实显示原文，不静默换成占位符——「现场报的就是这么个东西」本身
 * 就是要看的信息。
 * @param raw 槽里的原值
 * @param precision 固定几位小数
 * @param grouping 要不要千分位
 */
export function cellText(
  raw: unknown,
  precision: number,
  grouping: boolean,
): string {
  if (isPresent(raw)) return fmtDecimal(raw, precision, grouping)
  if (typeof raw === 'boolean') return raw ? 'true' : 'false'
  if (typeof raw === 'string' && raw.trim() !== '') return raw
  return NO_DATA
}

/** 整块共用的数值口径。 */
interface TableFormat {
  precision: number
  grouping: boolean
}

/** 一格的输入：这一列、这一格的结论与原值，以及整块的口径与规则。 */
interface CellInput {
  column: TableColumn
  slot: ModuleSlotMeta | undefined
  raw: unknown
  hasSlots: boolean
  format: TableFormat
}

/**
 * 一格读数。
 * ⚠ 非 `ok` 档一律不带单位：「— kV」看着像是有读数的。
 * @param input 这一列、这一格的结论与原值，以及整块的口径
 * @param rules 已规整的值规则
 */
function toCell(input: CellInput, rules: readonly TableRule[]): TableCellView {
  const state = cellState(input.slot, input.raw, input.hasSlots)
  const base = { key: input.column.key, state, align: input.column.align }
  if (state !== 'ok') {
    return {
      ...base,
      text: CELL_MARKS[state],
      title: reasonOf(state, input.slot),
      color: '',
      blink: false,
    }
  }
  const digits = input.column.precision ?? input.format.precision
  const text = cellText(input.raw, digits, input.format.grouping)
  const hit = evaluateTableRules(input.raw, input.column.key, rules)
  return {
    ...base,
    text: input.column.unit === '' ? text : `${text} ${input.column.unit}`,
    title: hit?.label ?? '',
    color: hit?.color ?? '',
    blink: hit?.blink ?? false,
  }
}

/**
 * 表头与数据行**共用**的列宽模板：行名列 + 逐列。
 * ⚠ 只有这一个来源。拆成两处字符串（表头一份、行一份）就会错列，而 typecheck
 * 与 lint 都看不出问题——错列了只能靠眼睛发现，故 look.test.ts 里有源码级断言守着。
 * @param columns 归一化后的列
 */
export function columnsTemplateOf(columns: readonly TableColumn[]): string {
  const cells = columns.map((column) =>
    column.width > 0
      ? `minmax(0, ${String(column.width)}px)`
      : 'minmax(0, 1fr)',
  )
  return [`minmax(0, ${String(NAME_COLUMN_FR)}fr)`, ...cells].join(' ')
}

/**
 * 空态口径。
 * ⚠ 「一列都没启用」与「一行都没配」各说各的：前者是列配置没挑键，后者是行还没加，
 * 合成一句「暂无数据」会让人对着一块空白猜是哪一头没配。
 * ⚠ 「每一格都还没绑」**不算空**：那时照画整张表，逐格四档才有地方交代。
 * @param config 该节点落库的配置
 * @param columns 归一化后的列
 * @param rowCount 归一化后的行数
 */
export function emptyStateOf(
  config: Record<string, unknown>,
  columns: readonly TableColumn[],
  rowCount: number,
): TableEmptyState {
  if (columns.length === 0) {
    return { isEmpty: true, text: TABLE_NO_COLUMN_TEXT }
  }
  if (rowCount === 0) {
    return {
      isEmpty: true,
      text: readTrimmedText(config.emptyText) || TABLE_EMPTY_TEXT,
    }
  }
  return { isEmpty: false, text: '' }
}

/**
 * 行数上限；`0` = 不限。
 * @param config 该节点落库的配置
 */
function readMaxRows(config: Record<string, unknown>): number {
  return clamp(Math.round(readNumber(config.maxRows, 0)), 0, TABLE_MAX_ROWS_CAP)
}

/**
 * 表下面那几句说明。
 * ⚠ 截断必须说出来：少画几行而不吭声，看的人会把它当成现场就这么多行。
 * @param total 归一化后一共几行
 * @param shown 真画出来几行
 * @param duplicated 因列键重复被丢掉几列
 */
function notesOf(total: number, shown: number, duplicated: number): string[] {
  const notes: string[] = []
  if (shown < total) {
    notes.push(`已截断：共 ${String(total)} 行，只显示前 ${String(shown)} 行。`)
  }
  if (duplicated > 0) {
    notes.push(
      `有 ${String(duplicated)} 列的列键重复，只画了先声明的那一条——重复的列读的是同一个子槽。`,
    )
  }
  return notes
}

/**
 * 整块的数值口径。
 * @param config 该节点落库的配置
 */
function readTableFormat(config: Record<string, unknown>): TableFormat {
  return {
    precision: clamp(
      Math.round(readNumber(config.precision, DEFAULT_PRECISION)),
      0,
      TABLE_PRECISION_MAX,
    ),
    grouping: readBoolean(config.grouping),
  }
}

/** 逐行组装要用到的、每一行都一样的那几样。 */
interface RowContext {
  columns: readonly TableColumn[]
  cells: readonly unknown[]
  slots: Readonly<Record<string, ModuleSlotMeta>> | undefined
  hasSlots: boolean
  format: TableFormat
  rules: readonly TableRule[]
}

/**
 * 一行。
 * @param name 配置里写的行名
 * @param index 文档序下标
 * @param context 每一行都一样的那几样
 * @param seen 已出现过的行名与它出现的次数
 */
function toRow(
  name: string,
  index: number,
  context: RowContext,
  seen: Map<string, number>,
): TableRowView {
  return {
    key: rowKey(name, seen),
    index,
    name: rowDisplayName(name, index),
    emitValue: name,
    cells: context.columns.map((column) =>
      toCell(
        {
          column,
          slot: context.slots?.[cellFieldKey(index, column.key)],
          raw: readRecord(context.cells[index])[column.key],
          hasSlots: context.hasSlots,
          format: context.format,
        },
        context.rules,
      ),
    ),
  }
}

/**
 * 一整块表。
 * @param input 配置、注入袋与逐槽结论
 */
export function buildTableView(input: TableViewsInput): TableView {
  const scan = scanTableColumns(input.config[TABLE_COLUMNS_KEY])
  const names = readTableRows(input.config[TABLE_ROWS_KEY])
  const max = readMaxRows(input.config)
  const kept = max > 0 ? names.slice(0, max) : names
  const context: RowContext = {
    columns: scan.columns,
    cells: readArray(input.rows),
    slots: input.slots,
    hasSlots: input.slots !== undefined,
    format: readTableFormat(input.config),
    rules: normalizeTableRules(input.config[TABLE_RULES_KEY]),
  }
  const seen = new Map<string, number>()
  return {
    columns: scan.columns,
    rows: kept.map((name, index) => toRow(name, index, context, seen)),
    columnsTemplate: columnsTemplateOf(scan.columns),
    notes: notesOf(names.length, kept.length, scan.duplicated),
    empty: emptyStateOf(input.config, scan.columns, names.length),
  }
}

/**
 * 绑点面板上每一行叫什么：名字给人看，联动值给人核对。
 * ⚠ 键是该行**第一个子槽**的 `fieldKey`（`bindingReport.ts` 就按这个查），
 * 而第一个子槽是清单里 `arrayFields[0]`，也就是 `c1`——与「用户启用了哪几列」无关。
 * @param config 该节点落库的配置
 */
export function tableRowLabels(
  config: Record<string, unknown>,
): Record<string, { title: string; id: string }> {
  const labels: Record<string, { title: string; id: string }> = {}
  readTableRows(config[TABLE_ROWS_KEY]).forEach((name, index) => {
    labels[cellFieldKey(index, TABLE_FIRST_COLUMN_KEY)] = {
      title: rowDisplayName(name, index),
      id: name,
    }
  })
  return labels
}

/**
 * 每个数组槽应有几行。
 * ⚠ 一行都没有时也要给 0，别把键漏掉：漏掉的槽会被绑点面板当成「行由用户手工增删」，
 * 于是摆出一个加了也永远喂不到东西的「新增一行」。
 * ⚠ 行数按**全量**行给，不按 `maxRows` 截断后的行给：截断只是屏上少画几行，
 * 那几行的绑定还在，面板上少摆几行等于让它们再也改不了。
 * @param config 该节点落库的配置
 */
export function tableRowCounts(
  config: Record<string, unknown>,
): Record<string, number> {
  return { [CELL_SLOT_KEY]: readTableRows(config[TABLE_ROWS_KEY]).length }
}
