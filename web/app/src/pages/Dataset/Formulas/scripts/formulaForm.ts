/**
 * @fileoverview 公式表单的纯逻辑：草稿状态、形参默认值的读写、校验与出参组装。
 *
 * 抽出来是为了能单测：每一条都对应后端 `FormulaCreateIn` 的一条约束，
 * 前端漏一条的表现是「点保存没反应」或一个指不到字段上的 422。
 *
 * ⚠ 后端**没有**库公式的校验端点：一条公式体离开形参无法单独解析，
 * 单独解析时值形参必然报「必须是字面量」（docs/DATASET_DESIGN.md §5.11）。
 * 所以这里只做**填没填、字符集对不对**这类本地判断，公式写不写得通由保存
 * 那一次的 400 说了算——保存键因此**不许**吊在某个校验结论上。
 */

import type { DatasetFormulaDef, DatasetFormulaParam } from '@dt/contracts'
import { DATASET_FORMULA_PARAM_KINDS } from '@dt/contracts'

import type {
  DatasetFormulaCreateInput,
  DatasetFormulaPatchInput,
} from '@/api/datasetFormulas'

import { KEY_CHARSET_HINT, KEY_PATTERN } from '../../scripts/datasetKey'
import { DEFAULT_CATEGORY } from './formulaView'

export const CODE_MAX = 64
export const NAME_MAX = 64
export const DESCRIPTION_MAX = 256
/** 与后端 `MAX_FORMULA_LENGTH` 同界。 */
export const EXPRESSION_MAX = 2000
/** 与后端 `MAX_FX_PARAMS` 同界。 */
export const PARAMS_MAX = 8
export const PARAM_LABEL_MAX = 64
export const PARAM_HINT_MAX = 128

/**
 * 表单里的一项形参。
 * ⚠ 多一个 `rowId`：形参没有 id，而 `v-for` 用索引做 key 是闸门错误——
 * 删中间一行会让其余行整体错位，正在输入的那一格连内容带焦点一起串位。
 */
export interface ParamDraft extends DatasetFormulaParam {
  rowId: string
}

export interface FormulaFormState {
  code: string
  name: string
  category: string
  expression: string
  description: string
  params: ParamDraft[]
}

export interface FormulaFormErrors {
  code: string
  name: string
  expression: string
  /** 形参表整体的问题（重名、字符集、超量），落在表头下面。 */
  params: string
}

/** 新建时的空白草稿。 */
function blankState(): FormulaFormState {
  return {
    code: '',
    name: '',
    category: DEFAULT_CATEGORY,
    expression: '',
    description: '',
    params: [],
  }
}

/**
 * 打开弹窗时的初值。`null` 即新建。
 * @param formula 正在改的那一条
 * @param nextRowId 发一个本次会话内唯一的行号
 */
export function formStateOf(
  formula: DatasetFormulaDef | null,
  nextRowId: () => string,
): FormulaFormState {
  if (formula === null) return blankState()
  return {
    code: formula.code,
    name: formula.name,
    category: formula.category,
    expression: formula.expression,
    description: formula.description ?? '',
    // ⚠ 逐项复制：直接用回参那个数组，表单里改一格就改到了列表上那一行，
    // 取消也退不回去
    params: formula.params.map((param) => ({
      ...param,
      rowId: nextRowId(),
    })),
  }
}

/** 加一个形参时的空白行。 */
export function blankParam(rowId: string): ParamDraft {
  return { rowId, name: '', kind: 'column', label: '', hint: '', default: null }
}

/** 下拉抛的是 string，用窄化收口而不是 `as` 断言。 */
export function toParamKind(
  value: string,
): DatasetFormulaParam['kind'] | undefined {
  return DATASET_FORMULA_PARAM_KINDS.find((kind) => kind === value)
}

/**
 * 默认值那一格：文本 → 落库形态。
 *
 * ⚠ 一律当字符串收会让**数字型默认值永远存不下来**：后端拼样例调用时走
 * `repr(default)`，字符串 `'12'` 渲成 `PREV({x}, '12')`，而 PREV 的期数只收
 * 整数字面量，于是保存永远失败，且报错指向 PREV 而不是这一格。
 * ⚠ 时间窗**不要**自己加引号（写 `24h` 不是 `'24h'`）：引号由后端补，
 * 手动再加一层会渲成 `"'24h'"`，窗口解析认不出来。
 * @param text 用户在那一格里打的字
 */
export function parseParamDefault(text: string): unknown {
  const trimmed = text.trim()
  if (trimmed === '') return null
  const unquoted = trimmed.replace(/^['"]|['"]$/g, '')
  if (unquoted === '') return null
  return Number.isFinite(Number(unquoted)) ? Number(unquoted) : unquoted
}

/** 落库形态 → 那一格里显示的文本。 */
export function paramDefaultText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  return typeof value === 'string' ? value : JSON.stringify(value)
}

/**
 * 这个值形参有没有默认值。
 * ⚠ `value` 形参的默认值**不是界面预填**，它是「这个位置该放什么」的唯一
 * 声明：落在只收字面量的位置（时间窗、`PREV` 的期数）而没有默认值，后端报的
 * 是「时间窗必须是字符串字面量」——那句话说的是校验用的**样例调用**，而要改的
 * 是这一格（docs/DATASET_DESIGN.md §5.11）。
 * @param param 一项形参
 */
export function lacksDefault(param: DatasetFormulaParam): boolean {
  return param.kind === 'value' && paramDefaultText(param.default) === ''
}

function codeError(code: string, isEdit: boolean): string {
  if (isEdit) return ''
  const trimmed = code.trim()
  if (trimmed === '') return '请填调用标识'
  if (trimmed.length > CODE_MAX) return `不超过 ${CODE_MAX} 个字符`
  return KEY_PATTERN.test(trimmed) ? '' : KEY_CHARSET_HINT
}

function paramsError(params: readonly DatasetFormulaParam[]): string {
  if (params.length > PARAMS_MAX) return `形参最多 ${PARAMS_MAX} 个`
  const names = params.map((param) => param.name.trim())
  if (names.some((name) => name === '')) return '每个形参都要有名字'
  const bad = names.find((name) => !KEY_PATTERN.test(name))
  if (bad !== undefined) return `形参「${bad}」${KEY_CHARSET_HINT}`
  const seen = new Set(names)
  if (seen.size !== names.length) return '形参名不能重复'
  return ''
}

function expressionError(expression: string): string {
  const trimmed = expression.trim()
  if (trimmed === '') return '请填公式体'
  return trimmed.length > EXPRESSION_MAX
    ? `不超过 ${EXPRESSION_MAX} 个字符`
    : ''
}

/**
 * 本地能判的那几条。判不了的（公式写不写得通）交给保存那一次。
 * @param state 当前草稿
 * @param isEdit 改一条已有的——标识不可改，故不校验
 */
export function validateFormulaForm(
  state: FormulaFormState,
  isEdit: boolean,
): FormulaFormErrors {
  return {
    code: codeError(state.code, isEdit),
    name: state.name.trim() === '' ? '请填名称' : '',
    expression: expressionError(state.expression),
    params: paramsError(state.params),
  }
}

export function hasError(errors: FormulaFormErrors): boolean {
  return Object.values(errors).some((message) => message !== '')
}

/** 形参表整理成落库形态：去掉两头空白，`label` / `hint` 空着就是空串。 */
function cleanParams(
  params: readonly DatasetFormulaParam[],
): DatasetFormulaParam[] {
  return params.map((param) => ({
    name: param.name.trim(),
    kind: param.kind,
    label: param.label.trim(),
    hint: param.hint.trim(),
    default: param.default ?? null,
  }))
}

export function toCreateInput(
  state: FormulaFormState,
): DatasetFormulaCreateInput {
  const description = state.description.trim()
  return {
    code: state.code.trim(),
    name: state.name.trim(),
    category: state.category,
    expression: state.expression.trim(),
    params: cleanParams(state.params),
    description: description === '' ? null : description,
  }
}

/**
 * 改一条。
 * ⚠ 启用开关**不在这里**：停用是一次可能被后端 409 拦下的独立动作，
 * 混进这张表单会让「改个名字」被一句「还有 3 个台账列在用它」挡下来
 * （docs/DATASET_DESIGN.md §5.11）。
 * @param state 当前草稿
 */
export function toPatchInput(
  state: FormulaFormState,
): DatasetFormulaPatchInput {
  const description = state.description.trim()
  return {
    name: state.name.trim(),
    category: state.category,
    expression: state.expression.trim(),
    params: cleanParams(state.params),
    description: description === '' ? null : description,
  }
}

/**
 * 这次改动动没动**口径**。只有它为真才该提「去重算」。
 * @param before 改之前的那一条
 * @param state 当前草稿
 */
export function isSemanticChange(
  before: DatasetFormulaDef,
  state: FormulaFormState,
): boolean {
  const sameExpression = before.expression === state.expression.trim()
  const sameParams =
    JSON.stringify(before.params) === JSON.stringify(cleanParams(state.params))
  return !sameExpression || !sameParams
}
