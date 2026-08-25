/**
 * @fileoverview 列表单的纯逻辑：标识建议、校验与出参组装。
 *
 * 抽出来是为了能单测：这几条规则各自对应后端 `ColumnCreateIn` 的一条约束，
 * 前端漏一条的表现是「点保存没反应」或一个指不到字段上的 422。
 */

import type {
  DatasetAggFunc,
  DatasetColumn,
  DatasetColumnSource,
  DatasetColumnType,
} from '@dt/contracts'
import type {
  DatasetColumnCreateInput,
  DatasetColumnPatchInput,
} from '@/api/dataset'

import { KEY_PATTERN } from '../../scripts/datasetKey'

export const KEY_MAX = 64
export const NAME_MAX = 64
export const UNIT_MAX = 32
export const DECIMALS_MIN = 0
export const DECIMALS_MAX = 10
/** 与后端 `node_key` 的 `minLength` 同界。 */
export const NODE_KEY_MIN = 3
export const NODE_KEY_MAX = 256
export const FORMULA_MAX = 2000

/** 表单此刻的取值。 */
export interface ColumnFormState {
  key: string
  name: string
  unit: string
  decimals: number | undefined
  dataType: DatasetColumnType
  source: DatasetColumnSource
  /** 点位身份 `{source_id}:{point_code}`。 */
  nodeKey: string
  agg: DatasetAggFunc
  formula: string
  isRequired: boolean
  /** 录入表单的预填值，按 `dataType` 解析后落库。 */
  defaultValue: string
}

/** 校验结果：四格都空即通过。 */
export interface ColumnFormErrors {
  key: string
  name: string
  nodeKey: string
  formula: string
}

export function emptyColumnForm(): ColumnFormState {
  return {
    key: '',
    name: '',
    unit: '',
    decimals: undefined,
    dataType: 'number',
    source: 'manual',
    nodeKey: '',
    agg: 'avg',
    formula: '',
    isRequired: false,
    defaultValue: '',
  }
}

/**
 * 默认值读回表单时的文本形态。
 * ⚠ 不直接 `String(...)`：`default_value` 出参是 `unknown`，对象走到 `String`
 * 会变成 `[object Object]`，用户看到的是一个再也存不回去的值。
 * @param value 库里存的原值
 */
function defaultValueText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  return JSON.stringify(value)
}

/**
 * 把一列铺进表单；`null` 即新增。
 * ⚠ 铺值收在这里而不是弹窗里：弹窗那侧只剩「写进各自的 ref」，于是
 * 「哪个字段缺省成什么」有且只有一处答案。
 * @param column 要编辑的列，`null` 表示新增
 */
/** 打开弹窗时的预填（助手的提议走这条）。两格都可缺席。 */
export interface ColumnFormSeed {
  formula?: string
  /** 只在新增时有意义：列标识建后不可改。 */
  key?: string
}

/**
 * 列 → 表单初值。
 * ⚠ 有预填公式时**连来源一起切成「公式」**：只填表达式的话，这一列仍是人工
 * 录入，保存下去那条公式一次都不算，而界面上看着一切正常。
 * @param column 正在编辑的那一列；`null` 即新增
 * @param seed 预填
 */
export function formStateOf(
  column: DatasetColumn | null,
  seed: ColumnFormSeed = {},
): ColumnFormState {
  const base = column === null ? emptyColumnForm() : fromColumn(column)
  const formula = seed.formula ?? ''
  if (formula === '') return base
  return {
    ...base,
    key: column === null ? (seed.key ?? base.key) : base.key,
    source: 'formula',
    formula,
  }
}

function fromColumn(column: DatasetColumn): ColumnFormState {
  return {
    key: column.key,
    name: column.name,
    unit: column.unit ?? '',
    decimals: column.decimals ?? undefined,
    dataType: column.data_type,
    source: column.source,
    nodeKey: column.node_key ?? '',
    agg: column.agg,
    formula: column.formula ?? '',
    isRequired: column.is_required,
    defaultValue: defaultValueText(column.default_value),
  }
}

/**
 * 名称 → 建议标识。只把会让公式歧义的字符换掉，中文原样留着：
 * 公式里写 `{进水量}` 比 `{inflow}` 直观得多，后端也放行。
 * @param name 列名称
 */
export function suggestKey(name: string): string {
  return name
    .trim()
    .replace(/[\s@'"(),.:{}[\]]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, KEY_MAX)
}

/**
 * 校验。
 * ⚠ 保存按钮在 `DtModal` 的 footer 插槽里、在 `<form>` 之外，原生 `required`
 * 永远不会触发；这里不给出错误文案就等于「点了没反应」。
 * @param state 表单取值
 * @param isEdit 编辑态：标识不可改，故不再校验它
 */
export function validateColumnForm(
  state: ColumnFormState,
  isEdit: boolean,
): ColumnFormErrors {
  return {
    key: isEdit ? '' : keyError(state.key),
    name: nameError(state.name),
    nodeKey: state.source === 'point' ? nodeKeyError(state.nodeKey) : '',
    formula: state.source === 'formula' ? formulaError(state.formula) : '',
  }
}

/** 一条都不剩才放行。 */
export function hasNoError(errors: ColumnFormErrors): boolean {
  return Object.values(errors).every((one) => one === '')
}

function nameError(name: string): string {
  const trimmed = name.trim()
  if (trimmed === '') return '请填列名称'
  if (trimmed.length > NAME_MAX) return `不超过 ${NAME_MAX} 个字`
  return ''
}

function keyError(key: string): string {
  const trimmed = key.trim()
  if (trimmed === '') return '请填列标识'
  if (trimmed.length > KEY_MAX) return `不超过 ${KEY_MAX} 个字符`
  if (!KEY_PATTERN.test(trimmed)) {
    return '不能含空格、@、引号、括号、逗号、点号、冒号或花括号'
  }
  return ''
}

function nodeKeyError(nodeKey: string): string {
  const trimmed = nodeKey.trim()
  if (trimmed.length < NODE_KEY_MIN)
    return '请填点位标识，形如 数据源id:点位编码'
  if (trimmed.length > NODE_KEY_MAX) return `不超过 ${NODE_KEY_MAX} 个字符`
  return ''
}

function formulaError(formula: string): string {
  const trimmed = formula.trim()
  if (trimmed === '') return '请写公式'
  if (trimmed.length > FORMULA_MAX) return `不超过 ${FORMULA_MAX} 个字符`
  return ''
}

/**
 * 默认值按数据类型解析回原值。存原值保类型，见 `ColumnCreateIn.default_value`。
 * ⚠ 数值填得不合法时落 `null` 而不是 `NaN`：`NaN` 进 JSON 会变成 `null` 之外的
 * 一个错误，而空的默认值只是「不预填」，不该拦住保存。
 * @param state 表单取值
 */
export function parseDefaultValue(state: ColumnFormState): unknown {
  const text = state.defaultValue.trim()
  if (text === '') return null
  if (state.dataType === 'number') {
    const parsed = Number(text)
    return Number.isFinite(parsed) ? parsed : null
  }
  if (state.dataType === 'bool') {
    return ['true', '1', '是', 'on'].includes(text.toLowerCase())
  }
  return text
}

/**
 * 新增与修改共用的那几项。
 * ⚠ 只有对应来源才带上各自的字段，其余一律清空：不清的话把一列从「点位汇总」
 * 改成「人工录入」之后，`node_key` 还留在库里，下次再改回点位会拿到一个
 * 谁也没选过的旧绑定。
 * ⚠ `agg` 后端 NOT NULL：非点位列也得给个合法值，回落到该列对它们无意义的默认档。
 */
function sharedFields(state: ColumnFormState) {
  const isPoint = state.source === 'point'
  const isManual = state.source === 'manual'
  return {
    name: state.name.trim(),
    unit: state.unit.trim().slice(0, UNIT_MAX) || null,
    decimals: state.decimals ?? null,
    data_type: state.dataType,
    source: state.source,
    agg: isPoint ? state.agg : ('avg' satisfies DatasetAggFunc),
    node_key: isPoint ? state.nodeKey.trim() : null,
    formula: state.source === 'formula' ? state.formula.trim() : null,
    is_required: isManual ? state.isRequired : false,
    default_value: isManual ? parseDefaultValue(state) : null,
  }
}

/**
 * 新增入参。
 * @param state 表单取值
 */
export function toCreateInput(
  state: ColumnFormState,
): DatasetColumnCreateInput {
  return { ...sharedFields(state), key: state.key.trim() }
}

/**
 * 修改补丁。
 * ⚠ 不含 `key`：它是数据行 JSONB 里的字段名，改一次等于让这一列的历史值集体
 * 失联，而每一行看起来都还在，故后端的 `ColumnUpdateIn` 里根本没有这一项。
 * @param state 表单取值
 */
export function toPatchInput(state: ColumnFormState): DatasetColumnPatchInput {
  return sharedFields(state)
}
