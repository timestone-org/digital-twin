/** @fileoverview 点位后端运行状态查询的可选项。 */
import type { CollectPointStatus } from '@dt/contracts'

export const POINT_STATUS_OPTIONS = [
  { value: 'all', label: '全部状态' },
  { value: 'abnormal', label: '全部异常' },
  { value: 'waiting', label: '等待数据' },
  { value: 'stale', label: '数据陈旧' },
  { value: 'good', label: '正常' },
] satisfies readonly { value: CollectPointStatus; label: string }[]
