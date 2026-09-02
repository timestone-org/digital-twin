/**
 * @fileoverview 把算子的 JSON Schema 摊成一张扁平的字段表，参数面板照着它渲染。
 *
 * ⚠ 枚举必须**解引用**：Pydantic 把枚举提到 `$defs` 里、字段上只留一个 `$ref`，
 * 不跟着跳一层的话所有枚举字段都会退化成一个自由文本框，用户能填进去任何词，
 * 而错误要等到运行那一刻才由后端报出来。
 */

/** 一个字段该用哪种控件。`table`/`column`/`moment` 来自 `x-dt-widget`。 */
export type FieldWidget =
  | 'text'
  | 'number'
  | 'integer'
  | 'switch'
  | 'select'
  | 'columns'
  | 'table'
  | 'moment'

/** 参数面板里的一行。 */
export interface FormField {
  key: string
  label: string
  hint: string
  widget: FieldWidget
  isRequired: boolean
  options: readonly { value: string; label: string }[]
  min: number | null
  max: number | null
  fallback: unknown
}

interface RawSchema {
  properties?: Record<string, unknown>
  required?: unknown
  $defs?: Record<string, unknown>
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' ? value : null
}

/** 跟着 `$ref` 跳进 `$defs`，把两层合成一层。 */
function deref(
  field: Record<string, unknown>,
  defs: Record<string, unknown>,
): Record<string, unknown> {
  const ref = asText(field['$ref'])
  const name = ref.startsWith('#/$defs/') ? ref.slice('#/$defs/'.length) : ''
  if (name === '') return field
  return { ...asRecord(defs[name]), ...field }
}

/**
 * 从描述里认出 `值=说明` 这样的成对写法，给枚举当选项文案。
 *
 * ⚠ 必须**每个枚举值都对得上**才用，否则宁可显示原始值：只覆盖一半时用户会以为
 * 剩下那几个选项坏了。
 */
function labelsFrom(
  hint: string,
  values: readonly string[],
): Map<string, string> {
  const pairs = new Map<string, string>()
  for (const part of hint.split(/[；;]/)) {
    const at = part.indexOf('=')
    if (at <= 0) continue
    pairs.set(part.slice(0, at).trim(), part.slice(at + 1).trim())
  }
  if (!values.every((value) => pairs.has(value)))
    return new Map<string, string>()
  return pairs
}

function optionsOf(field: Record<string, unknown>): FormField['options'] {
  const raw = field['enum']
  if (!Array.isArray(raw)) return []
  const values = raw.filter((item): item is string => typeof item === 'string')
  const labels = labelsFrom(asText(field['description']), values)
  return values.map((value) => ({ value, label: labels.get(value) ?? value }))
}

function widgetOf(
  field: Record<string, unknown>,
  options: FormField['options'],
): FieldWidget {
  const marked = asText(field['x-dt-widget'])
  if (marked === 'table') return 'table'
  if (marked === 'moment') return 'moment'
  if (marked === 'column') return 'columns'
  if (options.length > 0) return 'select'
  const type = asText(field['type'])
  if (type === 'boolean') return 'switch'
  if (type === 'integer') return 'integer'
  if (type === 'number') return 'number'
  return 'text'
}

/** 把一份算子 schema 摊成字段表。认不出来的键一律跳过。 */
export function fieldsOf(schema: Record<string, unknown>): FormField[] {
  const raw = schema as RawSchema
  const defs = asRecord(raw.$defs)
  const required = new Set(
    (Array.isArray(raw.required) ? raw.required : []).filter(
      (item): item is string => typeof item === 'string',
    ),
  )
  return Object.entries(asRecord(raw.properties)).map(([key, value]) => {
    const field = deref(asRecord(value), defs)
    const options = optionsOf(field)
    return {
      key,
      label: asText(field['title']) || key,
      hint: asText(field['description']),
      widget: widgetOf(field, options),
      isRequired: required.has(key),
      options,
      min: asNumber(field['minimum']),
      max: asNumber(field['maximum']),
      fallback: field['default'],
    }
  })
}

/** 一份参数的初值：schema 里写了默认就用它，没写按控件给空值。 */
export function defaultsOf(
  fields: readonly FormField[],
): Record<string, unknown> {
  const config: Record<string, unknown> = {}
  for (const field of fields) {
    if (field.fallback !== undefined) {
      config[field.key] = field.fallback
      continue
    }
    if (field.widget === 'columns') config[field.key] = []
    else if (field.widget === 'switch') config[field.key] = false
    else if (field.widget === 'number' || field.widget === 'integer') {
      config[field.key] = null
    } else config[field.key] = ''
  }
  return config
}

/**
 * 台账清单现在处于哪一步。`denied` 退回手填、`failed` 给重试——两者的处置
 * 完全不同，不能合成一句提示。
 */
export type TableListState = 'loading' | 'ready' | 'empty' | 'denied' | 'failed'

/** 参数面板要的两份下拉数据，以及拿不到时的那句人话。 */
export interface FormOptions {
  tables: readonly { code: string; name: string }[]
  tablesState: TableListState
  /** 台账下拉列不出东西时的原因。 */
  tablesNote: string
  columns: readonly { key: string; name: string }[]
  /** 列选择器列不出东西时的原因。 */
  columnsNote: string
}

/** 这个字段现在的值是不是就是 schema 给的默认值。 */
export function isDefault(field: FormField, value: unknown): boolean {
  if (field.fallback === undefined) return value === undefined
  return JSON.stringify(value) === JSON.stringify(field.fallback)
}

/**
 * 必填却空着时的那句话；不该报的时候给空串。
 *
 * ⚠ 只挡**必填且没有默认值**的：有默认值的字段留空是合法的，运行时按默认走。
 */
export function missingHint(field: FormField, value: unknown): string {
  if (!field.isRequired || field.fallback !== undefined) return ''
  const isBlank =
    value === undefined ||
    value === null ||
    value === '' ||
    (Array.isArray(value) && value.length === 0)
  return isBlank ? '这一项必须填' : ''
}
