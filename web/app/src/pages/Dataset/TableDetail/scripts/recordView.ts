/**
 * @fileoverview 数据表格一格显示什么：三层取值、样本数标记与人工修正角标的口径。
 *
 * ⚠ 取值只按 `compute_error → computed/values` 两层判，**绝不再叠一次
 * `overrides[].value`**：出参里的 `values` 已经是 effective（修正优先，
 * docs/DATASET_DESIGN.md D4）。叠第二次的错只在被修正过的格子上显形，
 * 而那正是最没人会去核对的那几格。
 * ⚠ `n = 0` 与「值是空的」是两件事：前者是「这个周期一条样本都没采到」，
 * 后者是「采到了，但值本身为空」。文案必须分开（§7.7）。
 */

import type {
  DatasetColumn,
  DatasetOverride,
  DatasetRecompute,
  DatasetRecord,
} from '@dt/contracts'

import { formatDateTime } from '@/utils/datetime'

/** 喂给 `DtDataView` 的一行。它要求每行有 `id`，而台账行的身份是 `row_id`。 */
export interface RecordRow {
  id: string
  /** 数据时间的本地时展示。 */
  time: string
  record: DatasetRecord
}

/**
 * 后端给的一页行 → 表格行。
 * @param records 一页数据行
 */
export function toRecordRows(records: readonly DatasetRecord[]): RecordRow[] {
  return records.map((record) => ({
    id: record.row_id,
    time: formatDateTime(record.ts),
    record,
  }))
}

/**
 * 这一格的求值错误，没有则 `null`。它是三层判断里的第一层。
 * @param record 一行
 * @param key 列标识
 */
export function computeErrorOf(
  record: DatasetRecord,
  key: string,
): string | null {
  return record.compute_error?.[key] ?? null
}

/**
 * 这一格的取值：公式列读 `computed`，其余读 `values`。
 * ⚠ 不碰 `overrides`——见文件头。
 * @param column 列定义
 * @param record 一行
 */
export function cellValue(
  column: DatasetColumn,
  record: DatasetRecord,
): unknown {
  const bag = column.source === 'formula' ? record.computed : record.values
  return bag[column.key]
}

// 一个数最多显示到这几位小数：列上没配 decimals 时的兜底，免得浮点误差
// 把一次相除摊成一屏十七位
const FALLBACK_DECIMALS = 6

/**
 * 一格的展示串。
 * ⚠ 空值统一成破折号，但它**不代表**「没采到数据」——那句话由样本数标记去说。
 * @param value 取值
 * @param column 列定义，用它的 `decimals`
 */
export function formatCell(value: unknown, column: DatasetColumn): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'boolean') return value ? '是' : '否'
  if (typeof value === 'number') return formatNumber(value, column.decimals)
  if (typeof value === 'string') return value
  if (typeof value === 'bigint') return value.toString()
  // 对象与数组原样序列化：认不出的形状也要如实摊出来，不许显示成一个空格子
  return JSON.stringify(value) ?? '—'
}

/**
 * 数值那一档。
 * @param value 数
 * @param decimals 列上配的展示小数位，`null` = 不限
 */
function formatNumber(value: number, decimals: number | null): string {
  if (!Number.isFinite(value)) return String(value)
  if (decimals !== null) return value.toFixed(decimals)
  return Number.isInteger(value)
    ? String(value)
    : String(Number(value.toFixed(FALLBACK_DECIMALS)))
}

/** 样本数的四档。`unknown` = 这一列压根不谈样本（人工录入列与公式列）。 */
export type SampleLevel = 'unknown' | 'ok' | 'low' | 'empty'

// 少于这么多条就算「样本太少」，与本页的中位数无关
export const LOW_SAMPLE_ABS = 3
// 不足本列中位数这个比例也算少：仪表半路断连的那几桶就是这样露出来的
export const LOW_SAMPLE_RATIO = 0.2
// 中位数本身太小时不做相对判断——3 条对 10 条并不说明什么
export const LOW_SAMPLE_RATIO_MIN_MEDIAN = 10

// 只有这几种口径对样本数敏感。末值 / 首值 / 增量一条样本就够，
// 而 count 的取值本身就是条数，标它「样本少」等于在说「这个数小」
const SAMPLE_SENSITIVE = new Set(['avg', 'min', 'max', 'sum'])

/** 判样本档时要的两个上下文。 */
export interface SampleContext {
  agg: string
  /** 本列在当前页的样本数中位数，没有基准时给 `null`。 */
  median: number | null
}

/**
 * 这一格的样本档。
 * @param count 桶内样本数，`undefined` = 这一列不谈样本
 * @param context 聚合口径与本页中位数
 */
export function sampleLevel(
  count: number | undefined,
  context: SampleContext,
): SampleLevel {
  if (count === undefined || !Number.isFinite(count) || count < 0) {
    return 'unknown'
  }
  // 0 条与口径无关：那个周期根本没采到数，任何聚合都无从谈起
  if (count === 0) return 'empty'
  if (!SAMPLE_SENSITIVE.has(context.agg)) return 'ok'
  if (count < LOW_SAMPLE_ABS) return 'low'
  const median = context.median
  if (
    median !== null &&
    median >= LOW_SAMPLE_RATIO_MIN_MEDIAN &&
    count < median * LOW_SAMPLE_RATIO
  ) {
    return 'low'
  }
  return 'ok'
}

/**
 * 样本档的悬停说明。`ok` 与 `unknown` 没什么可说的，给空串，调用方据此不挂气泡。
 * ⚠ 0 条那句**不许写成「值为空」**：用户看到空格子的第一反应是「谁把数删了」，
 * 而真相是那个周期一条都没采到。
 * @param count 桶内样本数
 * @param level 样本档
 */
export function sampleTip(
  count: number | undefined,
  level: SampleLevel,
): string {
  if (level === 'empty') {
    return '这个周期一条样本都没采到：格子里的空是「没有数据」，不是「值是空的」。'
  }
  if (level === 'low') {
    return `这个数只由 ${String(count)} 个样本汇总而来，代表性有限。`
  }
  return ''
}

/**
 * 中位数。空数组给 `null`——没有基准就不做相对判断。
 * @param list 一列样本数
 */
export function medianOf(list: readonly number[]): number | null {
  const sorted = [...list].sort((left, right) => left - right)
  if (sorted.length === 0) return null
  const mid = sorted.length >> 1
  const upper = sorted[mid]
  if (upper === undefined) return null
  if (sorted.length % 2 === 1) return upper
  const lower = sorted[mid - 1]
  return lower === undefined ? upper : (lower + upper) / 2
}

/**
 * 每一列在当前页的样本数中位数。
 * ⚠ 0 条的桶不进中位数：它们是「没采到」，拿来当基准会把整列的门槛拉到 0，
 * 于是再也没有一格会被标成「样本太少」。
 * @param columns 列定义
 * @param rows 当前这一页
 */
export function sampleMedians(
  columns: readonly DatasetColumn[],
  rows: readonly RecordRow[],
): Record<string, number | null> {
  const out: Record<string, number | null> = {}
  for (const column of columns) {
    const counts: number[] = []
    for (const row of rows) {
      const count = row.record.samples?.[column.key]
      if (count !== undefined && Number.isFinite(count) && count > 0) {
        counts.push(count)
      }
    }
    out[column.key] = medianOf(counts)
  }
  return out
}

/**
 * 这一格的人工修正痕迹，没有则 `null`。
 * ⚠ 它只是**标记**，不参与取值。
 * @param record 一行
 * @param key 列标识
 */
export function overrideOf(
  record: DatasetRecord,
  key: string,
): DatasetOverride | null {
  return record.overrides?.[key] ?? null
}

/**
 * 这条修正是不是数据迁移带进来的。
 * ⚠ 判据是**没有修正人 id**（契约里迁移条目的 `by` 恒为 null），不是拿用户名
 * 去猜：真有一个叫「迁移」的账号改过一格时，猜法会把它说成不是人改的。
 * @param entry 修正痕迹
 */
export function isMigrationOverride(entry: DatasetOverride): boolean {
  return entry.by === null
}

/** 角标画成什么样、以及悬停说什么。 */
export interface OverrideBadge {
  /** 已在 DtIcon 注册表登记的名字。 */
  icon: 'pencil' | 'database'
  /** 人改的用主题色，迁移带进来的调灰——后者不是本期有人动过手。 */
  toneClass: string
  /** 读屏与 `title` 用的短标签。 */
  label: string
  tip: string
}

/**
 * 一条修正的角标。
 * @param entry 修正痕迹
 */
export function overrideBadge(entry: DatasetOverride): OverrideBadge {
  const at = formatDateTime(entry.at)
  if (isMigrationOverride(entry)) {
    return {
      icon: 'database',
      toneClass: 'text-text-disabled',
      label: '数据迁移标记',
      tip: `这个值是数据迁移于 ${at} 带进来的，不是本期有人改动；撤销后这一格改用自动采集值。`,
    }
  }
  const who = entry.by_name?.trim() ?? ''
  const base = `由 ${who === '' ? '未知用户' : who} 于 ${at} 人工修正`
  const reason = entry.reason?.trim() ?? ''
  return {
    icon: 'pencil',
    toneClass: 'text-accent-primary',
    label: '人工修正',
    tip: reason === '' ? base : `${base}；原因：${reason}`,
  }
}

/** 撤销单格修正时要点名的那一格。 */
export interface RevokeTarget {
  row: RecordRow
  columnKey: string
  columnName: string
}

/**
 * 撤销单格修正的确认文案。
 * ⚠ 这里**不许承诺撤销后会变成哪个数**：自动值不在任何一个响应里，前端预览
 * 不出来。只能如实说会回落、可能不同、可能变空（§7.7）。
 * @param target 那一格
 */
export function revokeCellMessage(target: RevokeTarget): string {
  const { row } = target
  const entry = overrideOf(row.record, target.columnKey)
  const head = `撤销「${target.columnName}」在 ${row.time} 的人工修正？`
  const tail =
    '撤销后这一格回落到自动采集值，显示的数字可能与现在不同；那个周期若没采到数据，会变成空。'
  if (entry !== null && isMigrationOverride(entry)) {
    return `${head}这个值是数据迁移带进来的，不是本期有人改动。${tail}`
  }
  return `${head}${tail}`
}

/** 当前这一页的修正总览。 */
export interface OverrideStats {
  total: number
  /** 其中数据迁移带进来的格数。 */
  migration: number
  /** 本页真的带着角标的那几列，按列定义的顺序。 */
  keys: string[]
}

/**
 * 数一数本页有多少格修正。
 * ⚠ 只数**还在列定义里**的列：已删列的残留修正不在表里显示，计入统计会让用户
 * 去找一个根本看不见的角标。
 * @param columns 列定义
 * @param rows 当前这一页
 */
export function overrideStats(
  columns: readonly DatasetColumn[],
  rows: readonly RecordRow[],
): OverrideStats {
  let total = 0
  let migration = 0
  const keys: string[] = []
  for (const column of columns) {
    let seen = false
    for (const row of rows) {
      const entry = overrideOf(row.record, column.key)
      if (entry === null) continue
      total += 1
      seen = true
      if (isMigrationOverride(entry)) migration += 1
    }
    if (seen) keys.push(column.key)
  }
  return { total, migration, keys }
}

/** 一段时间范围，UTC RFC3339；空串表示不限。 */
export interface RecordRange {
  since: string
  until: string
}

/**
 * 时间范围填反了没有。任一端留空即不限，那时无所谓先后。
 * ⚠ 比的是解析出来的时刻而不是原串：两端一个来自后端、一个来自日期控件，
 * 小数位数不一定一样，按字典序比会在同一秒内判反。
 * @param since 起始时刻，UTC RFC3339；空串 = 不限
 * @param until 结束时刻，同上
 */
export function isRangeInverted(since: string, until: string): boolean {
  if (since === '' || until === '') return false
  const from = Date.parse(since)
  const to = Date.parse(until)
  if (Number.isNaN(from) || Number.isNaN(to)) return false
  return from > to
}

/**
 * 当前这一页的最早与最晚数据时间。
 * ⚠ 批量撤销的默认范围取它而**不是「不限」**：一次误点就抹掉三年的修正，
 * 而后端只回一个数字，看不出抹掉了什么（§7.8）。
 * @param rows 当前这一页
 */
export function pageRange(rows: readonly RecordRow[]): RecordRange {
  // ⚠ 比的是串不是 localeCompare：RFC3339 UTC 定长同格式，字典序就是时序，
  // 而 localeCompare 的结果随 runner 的 locale 变（CI 是中文、开发机是 en-US）
  const stamps = rows
    .map((row) => row.record.ts)
    .sort((left, right) => (left < right ? -1 : Number(left > right)))
  const first = stamps[0]
  const last = stamps[stamps.length - 1]
  if (first === undefined || last === undefined) return { since: '', until: '' }
  return { since: first, until: last }
}

/** 一句回执文案，外加它该用哪种语气。 */
export interface Receipt {
  text: string
  /** `true` = 事情没有全办完，界面要用警告色说出来。 */
  isPartial: boolean
}

/**
 * 重算回执的说法。
 * ⚠ 触顶与求值出错必须**逐条说出来**：只说「已重算 N 行」的话，一次只算了
 * 一半的重算与一次算完的重算长得一模一样（docs/DATASET_DESIGN.md §6.2）。
 * @param outcome 后端回执
 */
export function recomputeReceipt(outcome: DatasetRecompute): Receipt {
  const head = `已重算 ${String(outcome.recomputed)} 行`
  if (outcome.is_truncated) {
    return {
      text: `${head}，但待重算的行数触顶（单次上限 ${String(outcome.limit)} 行），还有没算完的，请再算一次。`,
      isPartial: true,
    }
  }
  if (outcome.failed > 0) {
    return {
      text: `${head}，其中 ${String(outcome.failed)} 行求值出错，表格里会标成「计算失败」。`,
      isPartial: true,
    }
  }
  return { text: head, isPartial: false }
}
