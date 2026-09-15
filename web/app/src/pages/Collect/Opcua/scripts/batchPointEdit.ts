/** @fileoverview 批量点位编辑的预览与校验，点位编码保持稳定。 */
import type { CollectPoint, CollectPointUpdateInput } from '@dt/contracts'

export const BATCH_FIELDS = [
  { value: 'unit', label: '单位' },
  { value: 'sampling_interval_ms', label: '采样间隔（毫秒）' },
  { value: 'deadband', label: '归档死区' },
  { value: 'archive_max_interval_ms', label: '归档心跳（毫秒）' },
  { value: 'name_prefix', label: '名称添加前缀' },
]
export interface PointEditPreview {
  id: string
  name: string
  before: string
  after: string
  input: CollectPointUpdateInput
}

export function previewPointEdits(
  points: readonly CollectPoint[],
  field: string,
  value: string,
): PointEditPreview[] {
  const text = value.trim()
  const number = validateValue(field, text)
  return points
    .map((point) => {
      const input = patchOf(point, field, text, number)
      const values: Record<string, string | number | null> = {
        unit: point.unit,
        sampling_interval_ms: point.sampling_interval_ms,
        deadband: point.deadband,
        archive_max_interval_ms: point.archive_max_interval_ms,
        name_prefix: point.name,
      }
      const before = String(values[field] ?? '')
      return {
        id: point.id,
        name: point.name,
        before,
        after: String(Object.values(input)[0] ?? ''),
        input,
      }
    })
    .filter((row) => row.before !== row.after)
}

function patchOf(
  point: CollectPoint,
  field: string,
  text: string,
  number: number,
): CollectPointUpdateInput {
  if (field === 'unit') return { unit: text || null }
  if (field === 'sampling_interval_ms') return { sampling_interval_ms: number }
  if (field === 'deadband') return { deadband: number }
  if (field === 'archive_max_interval_ms')
    return { archive_max_interval_ms: number }
  if (field === 'name_prefix') {
    const name = text + point.name
    if (name.length > 128)
      throw new Error('添加前缀后的名称不能超过 128 个字符')
    return { name }
  }
  throw new Error('不支持的批量字段')
}

function validateValue(field: string, text: string): number {
  if (field === 'name_prefix' && text === '') throw new Error('请填写名称前缀')
  const number = Number(text)
  const numeric = [
    'sampling_interval_ms',
    'deadband',
    'archive_max_interval_ms',
  ].includes(field)
  if (numeric) validateNumber(field, text, number)
  return number
}

function validateNumber(field: string, text: string, number: number): void {
  if (text === '' || !Number.isFinite(number) || number < 0)
    throw new Error('请填写有效的非负数')
  if (field !== 'deadband' && (!Number.isInteger(number) || number < 50))
    throw new Error('间隔必须是至少 50 毫秒的整数')
}
