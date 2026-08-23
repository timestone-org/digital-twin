/**
 * @fileoverview 录入 / 编辑一行的表单态与提交转换。
 *
 * ⚠ **点位汇总列只提交用户真的改过的那几格**。后端把这类列的提交值记成
 * 人工修正而不是覆盖采集原值（docs/DATASET_DESIGN.md §8.4），所以「打开编辑、
 * 什么都没动、点保存」若把回填出来的值原样送回去，会给整行的点位列凭空打上
 * 修正角标，而且署名是这次点保存的人。
 * ⚠ 人工录入列反过来**必须整份提交**：后端的必填校验看的是本次提交后的整行，
 * 漏送一列会被判成「必填列未填写」，哪怕库里那一格本来有值。
 * ⚠ 类型转换与取值校验一概交后端：两处各写一份规则，迟早漂成两种口径。
 */

import type { DatasetColumn, DatasetRecord } from '@dt/contracts'

import type { DatasetRecordInput } from '@/api/dataset'

/**
 * 表单态。文本与布尔分成两份而不是一个联合值的字典：合成一份的话，模板里
 * 每次取值都要断言成 string 或 boolean，而本仓禁止 `as`。
 */
export interface RecordFormState {
  /** 数据时间，UTC RFC3339；空串 = 还没选。 */
  ts: string
  texts: Record<string, string>
  flags: Record<string, boolean>
}

/** 能填的那几列：公式列由后端算，不接受手填。 */
export function writableColumns(
  columns: readonly DatasetColumn[],
): DatasetColumn[] {
  return columns.filter((column) => column.source !== 'formula')
}

/** 只读展示的公式列。 */
export function formulaColumns(
  columns: readonly DatasetColumn[],
): DatasetColumn[] {
  return columns.filter((column) => column.source === 'formula')
}

/**
 * 一个原始值 → 表单里的文本。
 * ⚠ `null` 与 `0` 不能合成一件：`0` 是个真实的读数。
 * @param value 原始值
 */
function toText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  return JSON.stringify(value) ?? ''
}

/**
 * 一个原始值 → 表单里的开关位。
 * @param value 原始值
 */
function toFlag(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value === 'string')
    return ['true', '1', 'yes', '是'].includes(value)
  return false
}

/**
 * 打开表单时的初值。
 * ⚠ 新建时点位汇总列一律留空：给它们填上什么，保存时就等于替这几格创建了
 * 人工修正。
 * @param record 正在编辑的那一行；`null` 即新建
 * @param columns 全部列定义
 * @param now 新建时的默认数据时间，缺省取此刻
 */
export function recordFormOf(
  record: DatasetRecord | null,
  columns: readonly DatasetColumn[],
  now: Date = new Date(),
): RecordFormState {
  const form: RecordFormState = {
    ts: record === null ? now.toISOString() : record.ts,
    texts: {},
    flags: {},
  }
  for (const column of writableColumns(columns)) {
    const seeded = seedOf(record, column)
    if (column.data_type === 'bool') form.flags[column.key] = toFlag(seeded)
    else form.texts[column.key] = toText(seeded)
  }
  return form
}

/**
 * 一列的初值来源。
 * @param record 正在编辑的那一行；`null` 即新建
 * @param column 列定义
 */
function seedOf(record: DatasetRecord | null, column: DatasetColumn): unknown {
  if (record !== null) return record.values[column.key]
  // ⚠ 新建时只有人工录入列吃默认值：点位列的默认值没有意义，填上去反而会在
  // 保存时变成一格人工修正
  return column.source === 'manual' ? column.default_value : null
}

/**
 * 这一列在表单里此刻的值。
 * @param form 表单态
 * @param column 列定义
 */
function valueOf(form: RecordFormState, column: DatasetColumn): unknown {
  if (column.data_type === 'bool') return form.flags[column.key] ?? false
  const text = form.texts[column.key] ?? ''
  // 空串一律作空值：对点位列它是「撤销这一格的修正」，对录入列是「清空」
  return text === '' ? null : text
}

/**
 * 表单态 → 提交载荷。
 * @param form 此刻的表单态
 * @param opened 打开表单那一刻的表单态，用来认出哪几格被动过
 * @param columns 全部列定义
 */
export function toRecordInput(
  form: RecordFormState,
  opened: RecordFormState,
  columns: readonly DatasetColumn[],
): DatasetRecordInput {
  const values: Record<string, unknown> = {}
  for (const column of writableColumns(columns)) {
    if (column.source === 'point' && !isTouched(form, opened, column)) continue
    values[column.key] = valueOf(form, column)
  }
  return { ts: form.ts, values }
}

/**
 * 这一格被动过没有。
 * @param form 此刻的表单态
 * @param opened 打开表单那一刻的表单态
 * @param column 列定义
 */
function isTouched(
  form: RecordFormState,
  opened: RecordFormState,
  column: DatasetColumn,
): boolean {
  if (column.data_type === 'bool') {
    return (
      (form.flags[column.key] ?? false) !== (opened.flags[column.key] ?? false)
    )
  }
  return (form.texts[column.key] ?? '') !== (opened.texts[column.key] ?? '')
}

/**
 * 输入框下那一行提示。
 * ⚠ 点位汇总列必须先把话说在前面：填进去的不是「改采集值」，而是**盖住**它。
 * @param column 列定义
 * @param record 正在编辑的那一行；`null` 即新建
 */
export function writeHint(
  column: DatasetColumn,
  record: DatasetRecord | null,
): string {
  if (column.source !== 'point') {
    return column.is_required ? '必填' : ''
  }
  const entry = record?.overrides?.[column.key]
  if (entry !== undefined) {
    return '这一格现在显示的是人工修正值；清空即撤销修正，回落到自动采集值'
  }
  return '点位汇总列：填了会记为人工修正，采集原值仍完整保留，随时可在表格里撤销'
}
