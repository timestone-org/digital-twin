/** @fileoverview 历史桶回填的输入校验与实际任务展示。 */
import type { DatasetBackfillStatus } from '@dt/contracts'
import { formatLocalMinute } from '@dt/ui'

export const BACKFILL_STATUS_LABELS: Record<DatasetBackfillStatus, string> = {
  running: '正在回填',
  done: '回填完成',
  cancelled: '已取消',
  failed: '回填失败',
}

export function backfillTime(value: string): string {
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? formatLocalMinute(timestamp) : value
}

export function backfillRangeProblem(
  since: string,
  until: string,
): string | null {
  const start = Date.parse(since)
  const end = Date.parse(until)
  if (!Number.isFinite(start) || !Number.isFinite(end))
    return '请填写完整的起始时间与结束时间'
  if (start > end) return '起始时间不能晚于结束时间'
  return null
}
