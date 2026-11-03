/** @fileoverview 流水线迁移文件的容量、JSON校验与逻辑请求比较。 */
import { describeError } from '@/composables/useAsyncList'

const MAX_FILE_BYTES = 2 * 1024 * 1024
class ImportFileError extends Error {}

export async function readDocument(file: File): Promise<unknown> {
  if (!file.name.toLowerCase().endsWith('.json'))
    throw new ImportFileError('请选择 JSON 文件')
  if (file.size > MAX_FILE_BYTES)
    throw new ImportFileError('JSON 文件不能超过 2 MB')
  try {
    return JSON.parse((await file.text()).replace(/^\uFEFF/, '')) as unknown
  } catch {
    throw new ImportFileError('文件不是有效的 JSON，请重新选择导出的流水线文件')
  }
}

export function describeImportError(caught: unknown): string {
  return caught instanceof ImportFileError
    ? caught.message
    : describeError(caught)
}

export function jsonFingerprint(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(jsonFingerprint).join(',')}]`
  if (typeof value === 'object' && value !== null) {
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${jsonFingerprint(Reflect.get(value, key))}`,
      )
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}
