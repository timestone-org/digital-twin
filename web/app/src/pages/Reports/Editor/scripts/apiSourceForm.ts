/** @fileoverview API 数据源表单边界、引用检查与非秘密参数解析。 */
import type { ReportBody, ReportDocument, ReportMetric } from '@dt/contracts'

export type ApiSource = NonNullable<ReportBody['api_sources']>[number]
export type ApiColumn = ApiSource['columns'][number]
export function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
export function jsonObject(
  text: string,
  label: string,
): Record<string, unknown> {
  let value: unknown
  try {
    value = JSON.parse(text || '{}')
  } catch {
    throw new Error(`${label}必须为有效的 JSON 对象`)
  }
  if (!isObject(value)) throw new Error(`${label}必须为 JSON 对象`)
  return value
}
export function queryObject(text: string): Record<string, string> {
  const value = jsonObject(text, '查询参数')
  const result: Record<string, string> = {}
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== 'string') throw new Error('查询参数的值必须为字符串')
    result[key] = item
  }
  return result
}
export function validPointer(pointer: string): boolean {
  return (
    (pointer === '' || pointer.startsWith('/')) && !/~(?![01])/u.test(pointer)
  )
}
export function sourceIsUsed(
  document: ReportDocument,
  metrics: readonly ReportMetric[],
  code: string,
): boolean {
  const table = `api:${code}`
  if (metrics.some((metric) => metric.table === table)) return true
  function uses(value: unknown): boolean {
    if (Array.isArray(value)) return value.some((item: unknown) => uses(item))
    if (!isObject(value)) return false
    return value['table'] === table || Object.values(value).some(uses)
  }
  return uses(document)
}
const CODE = /^[A-Za-z][A-Za-z0-9_]*$/u
export function validateSource(source: ApiSource): void {
  if (!CODE.test(source.code) || source.code.length > 60)
    throw new Error(
      '来源编码须以英文字母开头，仅使用字母、数字、下划线，最多 60 字符',
    )
  if (!source.name.trim() || !source.connection)
    throw new Error('请填写来源名称并选择已授权连接')
  validatePath(source.path)
  validateMapping(source)
  validateColumns(source.columns)
}
function validatePath(value: string): void {
  let path: string
  try {
    path = decodeURIComponent(value)
  } catch {
    throw new Error('API 相对路径编码无效')
  }
  if (
    !path.startsWith('/') ||
    path.startsWith('//') ||
    /[\\?#%\s]/u.test(path) ||
    path.split('/').some((part) => part === '.' || part === '..')
  )
    throw new Error('API 路径须以 / 开头，不含完整网址、查询参数或跳转路径')
}
function validateMapping(source: ApiSource): void {
  const offset = source.offset ?? 0
  if (!Number.isInteger(offset) || Math.abs(offset) > 120)
    throw new Error('报告期偏移须为 -120 到 120 的整数')
  const pointers = [source.rows_pointer ?? '', source.time_pointer ?? '']
  if (!pointers.every(validPointer))
    throw new Error('JSON Pointer 须为空或以 / 开头；~ 仅使用 ~0 和 ~1 转义')
}
function validateColumns(columns: readonly ApiColumn[]): void {
  if (!columns.length || columns.length > 50)
    throw new Error('请配置 1～50 个映射字段')
  const keys = new Set<string>()
  for (const column of columns) {
    if (!CODE.test(column.key) || !column.name.trim() || keys.has(column.key))
      throw new Error('字段编码须以字母开头且不能重复，字段名称必填')
    if (!validPointer(column.pointer))
      throw new Error(`字段 ${column.name} 的 JSON Pointer 无效`)
    keys.add(column.key)
  }
}
