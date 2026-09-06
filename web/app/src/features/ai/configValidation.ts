/** @fileoverview 助手配置写入的 schema 校验与不可变补丁。 */
import type { ConfigField, ModuleManifest } from '@dt/contracts'
import { resolveModuleConfig } from '@dt/runtime'
import {
  readConfigAt,
  writeConfigAt,
  type ConfigPath,
} from '@/features/dashboard/configPath'

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function fail(field: ConfigField, reason: string): never {
  throw new Error(`${field.key}：${reason}`)
}

function validateNumber(field: ConfigField, value: unknown): void {
  if (typeof value !== 'number' || !Number.isFinite(value))
    fail(field, '必须是有限数字')
  if (value < (field.min ?? -Infinity) || value > (field.max ?? Infinity))
    fail(field, '超出 min / max 范围')
}

function validateText(field: ConfigField, value: unknown): void {
  if (typeof value !== 'string') fail(field, '必须是字符串')
}

function validateBoolean(field: ConfigField, value: unknown): void {
  if (typeof value !== 'boolean') fail(field, '必须是布尔值')
}

function validateEnum(field: ConfigField, value: unknown): void {
  if (
    field.options !== undefined &&
    !field.options.some(
      (one) => JSON.stringify(one.value) === JSON.stringify(value),
    )
  )
    fail(field, '不在 options 中')
}

function validateArray(field: ConfigField, value: unknown): void {
  if (!Array.isArray(value)) fail(field, '必须是数组')
  if (
    value.length < (field.minItems ?? 0) ||
    value.length > (field.maxItems ?? Infinity)
  )
    fail(field, '数组项数超出限制')
  const rows: unknown[] = value
  for (const row of rows)
    validateObject(
      { ...field, type: 'object', fields: field.itemSchema ?? [] },
      row,
    )
}

/** 对象中的未提供字段仍由渲染默认值兜底。 */
function validateObject(field: ConfigField, value: unknown): void {
  if (!record(value)) fail(field, '必须是对象')
  const fields = childrenOf(field)
  if (fields === undefined) fail(field, '对象结构未声明，请使用子编辑器')
  for (const [key, item] of Object.entries(value)) {
    const child = fields.find((one) => one.key === key)
    if (child === undefined) fail(field, `没有子字段 ${key}`)
    validateConfigValue(child, item)
  }
}

const VALIDATORS: Partial<
  Record<ConfigField['type'], (field: ConfigField, value: unknown) => void>
> = {
  number: validateNumber,
  range: validateNumber,
  boolean: validateBoolean,
  enum: validateEnum,
  array: validateArray,
  object: validateObject,
  font: validateObject,
  style: validateObject,
  json: () => undefined,
}

/** 校验字段值；null 表示删除覆盖值。 */
export function validateConfigValue(field: ConfigField, value: unknown): void {
  if (value === null) return
  if (value === undefined) fail(field, '缺少 value')
  const validate = VALIDATORS[field.type] ?? validateText
  validate(field, value)
}

/** 字体与样式槽的固定键来自契约 FontValue / StyleSlotValue。 */
function childrenOf(field: ConfigField): ConfigField[] | undefined {
  if (field.type === 'font')
    return [
      { key: 'family', label: '字体', type: 'string' },
      { key: 'size', label: '字号', type: 'number' },
      { key: 'weight', label: '字重', type: 'json' },
      { key: 'letterSpacing', label: '字间距', type: 'number' },
      { key: 'color', label: '颜色', type: 'color' },
    ]
  if (field.type === 'style')
    return [
      { key: 'color', label: '颜色', type: 'color' },
      { key: 'background', label: '背景', type: 'string' },
      { key: 'border', label: '边框', type: 'string' },
      { key: 'borderRadius', label: '圆角', type: 'number' },
      { key: 'boxShadow', label: '阴影', type: 'string' },
      { key: 'padding', label: '内边距', type: 'string' },
      { key: 'opacity', label: '透明度', type: 'number', min: 0, max: 1 },
    ]
  return field.fields
}

function arrayEntry(current: unknown, index: string | number): unknown {
  if (
    !Array.isArray(current) ||
    typeof index !== 'number' ||
    !Number.isInteger(index) ||
    index < 0 ||
    index >= current.length
  )
    throw new Error('数组下标越界')
  const rows: unknown[] = current
  return rows[index]
}

/** 沿 schema 与当前有效配置同时检查路径，数组不得跳号。 */
function checkPath(
  field: ConfigField,
  current: unknown,
  path: ConfigPath,
  value: unknown,
): void {
  const [head, ...rest] = path
  if (head === undefined) return validateConfigValue(field, value)
  if (field.type === 'json') return
  if (field.type === 'array') {
    return checkPath(
      {
        key: field.key,
        label: field.label,
        type: 'object',
        fields: field.itemSchema ?? [],
      },
      arrayEntry(current, head),
      rest,
      value,
    )
  }
  const fields = childrenOf(field)
  if (fields === undefined) throw new Error(`${field.key} 不允许写此子路径`)
  const child = fields.find((one) => one.key === head)
  if (child === undefined)
    throw new Error(`${field.key} 没有子字段 ${String(head)}`)
  checkPath(child, readConfigAt(current, [head]) ?? child.default, rest, value)
}

/** 生成通过校验的配置；只为被修改的顶层字段补默认，null 删除键。 */
export function checkedConfigPatch(
  manifest: ModuleManifest,
  config: Record<string, unknown>,
  path: ConfigPath,
  value: unknown,
): Record<string, unknown> {
  const [head, ...rest] = path
  const field = manifest.configSchema.find((one) => one.key === head)
  if (field === undefined) throw new Error(`没有配置字段 ${String(head)}`)
  if (head === manifest.subEditor?.configKey)
    throw new Error('该配置由子编辑器管理')
  const effective = resolveModuleConfig(manifest, config)
  checkPath(field, effective[field.key], rest, value)
  const base =
    rest.length === 0
      ? config
      : { ...config, [field.key]: effective[field.key] }
  const next =
    value === null
      ? deleteOverride(base, path)
      : writeConfigAt(base, path, value)
  validateModuleConfig(manifest, next)
  return next
}

/** 删除一格覆盖值，保留其它路径与撤销快照。 */
export function deleteOverride(
  base: Record<string, unknown>,
  path: ConfigPath,
): Record<string, unknown> {
  const parentPath = path.slice(0, -1)
  const parent = readConfigAt(base, parentPath)
  const key = path.at(-1)
  if (parent === undefined) return base
  if (!record(parent) || typeof key !== 'string')
    throw new Error('删除数组行请用 remove_config_item')
  const next = { ...parent }
  delete next[key]
  return writeConfigAt(base, parentPath, next)
}

/** 模块自己的语义规则与字段 schema 分开，助手不硬编码模块类型。 */
export function validateModuleConfig(
  manifest: ModuleManifest | undefined,
  config: Record<string, unknown>,
): void {
  const errors =
    manifest?.validateConfig?.(resolveModuleConfig(manifest, config)) ?? []
  if (errors.length > 0) throw new Error(errors.join('；'))
}
