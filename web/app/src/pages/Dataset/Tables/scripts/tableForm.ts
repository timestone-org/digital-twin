/**
 * @fileoverview 建表 / 改表表单的纯逻辑：编码建议、校验与出参组装。
 *
 * 抽出来是为了能单测：这几条规则各自对应后端的一条 CHECK 约束，前端漏一条的
 * 表现是「点保存没反应」或一个指不到字段上的 422。
 */

import type { DatasetCollectMode, DatasetTableSummary } from '@dt/contracts'
import type {
  DatasetTableCreateInput,
  DatasetTablePatchInput,
} from '@/api/dataset'

/** 与后端 `TableCreateIn.code` 的 pattern 逐字一致。 */
export const CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
export const CODE_MAX = 64
export const NAME_MAX = 64
export const DESCRIPTION_MAX = 256
/** 与后端 `collect_interval_ms` 的 `[1000, 86_400_000]` 同界，换算成秒。 */
export const INTERVAL_S_MIN = 1
export const INTERVAL_S_MAX = 86_400
export const DEFAULT_INTERVAL_S = 60

/** 表单此刻的取值。周期以**秒**记：让人对着 60000 数零是没必要的。 */
export interface TableFormState {
  code: string
  name: string
  description: string
  collectMode: DatasetCollectMode
  intervalSeconds: number | undefined
  retentionDays: number | undefined
  isEnabled: boolean
}

/** 校验结果：哪个字段错了、错在哪。两个都空即通过。 */
export interface TableFormErrors {
  code: string
  name: string
}

export function emptyTableForm(): TableFormState {
  return {
    code: '',
    name: '',
    description: '',
    collectMode: 'manual',
    intervalSeconds: DEFAULT_INTERVAL_S,
    retentionDays: undefined,
    isEnabled: true,
  }
}

/**
 * 把一张已有的台账铺进表单；`null` 即新建。
 * ⚠ 铺值收在这里而不是弹窗里：弹窗那侧只剩「把这些值写进各自的 ref」，
 * 于是「哪个字段缺省成什么」有且只有一处答案。
 * @param table 要编辑的台账，`null` 表示新建
 */
export function formStateOf(table: DatasetTableSummary | null): TableFormState {
  if (table === null) return emptyTableForm()
  return {
    code: table.code,
    name: table.name,
    description: table.description ?? '',
    collectMode: table.collect_mode,
    intervalSeconds: Math.round(table.collect_interval_ms / 1000),
    retentionDays: table.retention_days ?? undefined,
    isEnabled: table.is_enabled,
  }
}

/**
 * 名称 → 建议编码：取名称里的 ASCII 片段。
 * ⚠ 全中文的名称推不出编码，此时返回空串让人自己填——胡乱兜一个
 * `t_1` 会变成一堆没人认得出的绑定键前半段。
 * @param name 台账名称
 */
export function suggestCode(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, CODE_MAX)
}

/**
 * 校验。
 * ⚠ 保存按钮在 `DtModal` 的 footer 插槽里、在 `<form>` 之外，原生 `required`
 * 永远不会触发；这里不给出错误文案就等于「点了没反应」。
 * @param state 表单取值
 * @param isEdit 编辑态：编码不可改，故不再校验它
 */
export function validateTableForm(
  state: TableFormState,
  isEdit: boolean,
): TableFormErrors {
  return { code: isEdit ? '' : codeError(state.code), name: nameError(state) }
}

function nameError(state: TableFormState): string {
  const name = state.name.trim()
  if (name === '') return '请填台账名称'
  if (name.length > NAME_MAX) return `不超过 ${NAME_MAX} 个字`
  return ''
}

function codeError(code: string): string {
  if (code.trim() === '') return '请填台账编码'
  if (code.length > CODE_MAX) return `不超过 ${CODE_MAX} 个字符`
  if (!CODE_PATTERN.test(code)) {
    return '只能用字母、数字与 . _ -，且以字母或数字开头'
  }
  return ''
}

/** 建表与改表共用的那几项。返回类型交给推断：它要同时满足建与改两个入参。 */
function sharedFields(state: TableFormState) {
  return {
    name: state.name.trim(),
    description: state.description.trim() || null,
    collect_mode: state.collectMode,
    collect_interval_ms: (state.intervalSeconds ?? DEFAULT_INTERVAL_S) * 1000,
    retention_days: state.retentionDays ?? null,
    is_enabled: state.isEnabled,
  }
}

/**
 * 建表入参。
 * @param state 表单取值
 */
export function toCreateInput(state: TableFormState): DatasetTableCreateInput {
  return { ...sharedFields(state), code: state.code.trim() }
}

/**
 * 改表补丁。
 * ⚠ 不含 `code`：它是大屏绑定键 `ds:{code}:{列key}` 的前半段，改一次等于让
 * 每一处引用它的绑定悄悄失效，故后端的 `TableUpdateIn` 里根本没有这一项。
 * @param state 表单取值
 */
export function toPatchInput(state: TableFormState): DatasetTablePatchInput {
  return sharedFields(state)
}
