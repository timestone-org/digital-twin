/** @fileoverview HTTP JSON 样例的叶子路径、类型预览与点位草稿。 */
import type { CollectDataType } from '@dt/contracts'
import { COLLECT_POINT_BATCH_MAX } from '@dt/contracts'
import type { ImportDraft } from './importDrafts'

const MAX_DEPTH = 32
const MAX_SAMPLE_LENGTH = 1_048_576

export interface HttpPointDraft extends ImportDraft {
  preview: string
}

export interface HttpSampleResult {
  rows: HttpPointDraft[]
  skippedNulls: number
  unsafeIntegers: number
  error: string | null
}

function valueType(value: unknown): CollectDataType | null {
  if (typeof value === 'number') {
    if (!Number.isFinite(value))
      throw new Error('样例数值超出有限数值范围，请让接口使用 JSON 字符串返回')
    if (!Number.isInteger(value)) return 'float'
    return Number.isSafeInteger(value) ? 'int' : 'string'
  }
  if (typeof value === 'boolean') return 'bool'
  if (typeof value === 'string') return 'string'
  return null
}

function isUnsafeIntegerValue(value: unknown): boolean {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    !Number.isSafeInteger(value)
  )
}

function escapeSegment(value: string): string {
  return value.replaceAll('~', '~0').replaceAll('/', '~1')
}

function suggestCode(parts: readonly string[], order: number): string {
  const code = parts
    .join('_')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 55)
  return code === ''
    ? `point_${order}`
    : /^[A-Za-z0-9]/.test(code)
      ? code
      : `point_${code}`
}

function addLeaf(
  result: HttpSampleResult,
  parts: readonly string[],
  value: unknown,
): void {
  const fieldType = valueType(value)
  if (fieldType === null) {
    if (value === null) result.skippedNulls += 1
    return
  }
  if (result.rows.length >= COLLECT_POINT_BATCH_MAX)
    throw new Error(
      `一次最多解析 ${COLLECT_POINT_BATCH_MAX} 个字段，请缩小样例响应范围`,
    )
  const isUnsafeInteger = isUnsafeIntegerValue(value)
  if (isUnsafeInteger) result.unsafeIntegers += 1
  const base = suggestCode(parts, result.rows.length + 1)
  const used = new Set(result.rows.map((row) => row.code))
  let code = base
  for (let suffix = 2; used.has(code); suffix += 1) code = `${base}_${suffix}`
  const address =
    parts.length === 0 ? '$' : `/${parts.map(escapeSegment).join('/')}`
  if (validateHttpPointer(address) !== null)
    throw new Error('JSON 字段路径超过 1024 字符，请缩小字段名长度')
  result.rows.push({
    address,
    name: (parts.at(-1) || '响应值').slice(0, 128),
    code,
    fieldType,
    preview: isUnsafeInteger ? '超出安全整数范围，无法精确预览' : String(value),
  })
}

function walk(
  result: HttpSampleResult,
  parts: readonly string[],
  value: unknown,
): void {
  if (parts.length > MAX_DEPTH)
    throw new Error(`JSON 层级不能超过 ${MAX_DEPTH} 层`)
  if (Array.isArray(value)) {
    value.forEach((item: unknown, index) =>
      walk(result, [...parts, String(index)], item),
    )
    return
  }
  if (typeof value === 'object' && value !== null) {
    for (const [key, item] of Object.entries(value))
      walk(result, [...parts, key], item)
    return
  }
  addLeaf(result, parts, value)
}

export function parseHttpSample(sample: string): HttpSampleResult {
  const result: HttpSampleResult = {
    rows: [],
    skippedNulls: 0,
    unsafeIntegers: 0,
    error: null,
  }
  if (sample.length > MAX_SAMPLE_LENGTH)
    return { ...result, error: '样例 JSON 不能超过 1 MiB' }
  try {
    const value: unknown = JSON.parse(sample)
    walk(result, [], value)
    return result
  } catch (caught) {
    return {
      ...result,
      rows: [],
      error:
        caught instanceof SyntaxError
          ? '样例不是有效 JSON，请检查格式'
          : caught instanceof Error
            ? caught.message
            : 'JSON 解析失败',
    }
  }
}

export function validateHttpPointer(address: string): string | null {
  if (address === '$') return null
  if (
    !address.startsWith('/') ||
    /~(?![01])/.test(address) ||
    address.length > 1024 ||
    address.split('/').length > 65
  )
    return 'HTTP 寻址串应为 JSON Pointer（如 /data/0/value，~0 表示 ~，~1 表示 /）；根标量用 $'
  return null
}
