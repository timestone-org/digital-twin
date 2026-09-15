/** @fileoverview 点位表当前页的运行状态分类；状态统计不冒充全数据源统计。 */
import type { PointSample } from '@dt/contracts'

export const POINT_STATUS_OPTIONS = [
  { value: 'all', label: '本页全部' },
  { value: 'abnormal', label: '本页异常' },
  { value: 'waiting', label: '本页等待数据' },
  { value: 'stale', label: '本页陈旧' },
  { value: 'good', label: '本页正常' },
]

export function pointStatus(
  sample: PointSample | undefined,
  stale: boolean,
): string {
  if (sample === undefined) return 'waiting'
  if (stale) return 'stale'
  if (sample.state === 'error' || sample.quality !== 'good') return 'abnormal'
  return 'good'
}
