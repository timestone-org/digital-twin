/** @fileoverview 将公开签名转成试算字段提示，并校验逐行 JSON 输入。 */
import type { OpenModelDetectRequest } from '@dt/contracts'
import type { ModelingServingAction } from '@/api/modelingServing'

type InputRow = OpenModelDetectRequest['rows'][number]

export interface TrialModel {
  action: ModelingServingAction
  inputs: {
    key: string
    label: string
    unit: string
    dtype: string
    required: boolean
  }[]
  requiresTimestamp: boolean
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : null
}

function actionOf(task: unknown): ModelingServingAction {
  if (task === 'anomaly_detection') return 'detect'
  if (task === 'rule_calculation') return 'calculate'
  if (task === 'regression' || task === 'classification') return 'predict'
  throw new Error('模型签名未声明可识别的任务类型，无法试算')
}

function inputOf(raw: unknown): TrialModel['inputs'][number] {
  const input = record(raw) ?? {}
  const key = input['key']
  if (typeof key !== 'string' || key === '')
    throw new Error('模型签名的输入字段缺少 key')
  return {
    key,
    label: typeof input['label'] === 'string' ? input['label'] : key,
    unit: typeof input['unit'] === 'string' ? input['unit'] : '',
    dtype: typeof input['dtype'] === 'string' ? input['dtype'] : '',
    required: input['is_required'] === true,
  }
}

export function readTrialModel(raw: unknown): TrialModel {
  const signature = record(raw)
  const inputs = signature?.['inputs']
  if (!Array.isArray(inputs))
    throw new Error('模型没有可用的输入签名，请重新训练并发布')
  return {
    action: actionOf(record(signature?.['output'])?.['task']),
    inputs: inputs.map(inputOf),
    requiresTimestamp: signature?.['requires_timestamp'] === true,
  }
}

export function trialExample(model: TrialModel): string {
  const row = Object.fromEntries(model.inputs.map((input) => [input.key, null]))
  if (model.requiresTimestamp) row['__ts__'] = null
  return JSON.stringify({ rows: [row] }, null, 2)
}

function readRows(raw: unknown, maxRows: number): InputRow[] {
  const body = record(raw)
  const rows = body?.['rows']
  if (
    !Array.isArray(rows) ||
    Object.keys(body ?? {}).some((key) => key !== 'rows')
  )
    throw new Error('请输入 {"rows": [{"字段": 值}]} 格式的对象')
  if (rows.length === 0 || rows.length > maxRows)
    throw new Error(`每次请输入 1–${maxRows} 行数据`)
  return rows.map(readRow)
}

function readRow(raw: unknown): InputRow {
  const row = record(raw)
  if (!row) throw new Error('rows 中的每一行都必须是对象')
  const entries: [string, number | string | null][] = []
  for (const [key, value] of Object.entries(row)) {
    if (
      value === null ||
      typeof value === 'string' ||
      (typeof value === 'number' && Number.isFinite(value))
    )
      entries.push([key, value])
    else throw new Error(`字段 ${key} 只接受数字、文本或 null`)
  }
  return Object.fromEntries(entries)
}

export function parseTrialRows(
  text: string,
  maxRows: number,
): { rows: InputRow[] | null; error: string } {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { rows: null, error: 'JSON 格式不完整，请检查引号、逗号与括号' }
  }
  try {
    return { rows: readRows(parsed, maxRows), error: '' }
  } catch (caught) {
    return {
      rows: null,
      error: caught instanceof Error ? caught.message : '输入格式错误',
    }
  }
}
