/** @fileoverview 批量修改逐条记录结果，只由用户重试失败项。 */
import { ref } from 'vue'
import { updatePoint } from '@/api/collect'
import { describeError } from '@/composables/useAsyncList'
import type { PointEditPreview } from './batchPointEdit'

export function useBatchPointEdit() {
  const busy = ref(false)
  const completed = ref(0)
  const failures = ref<(PointEditPreview & { error: string })[]>([])
  async function save(rows: readonly PointEditPreview[]): Promise<void> {
    if (busy.value) return
    busy.value = true
    completed.value = 0
    failures.value = []
    try {
      for (const row of rows) {
        try {
          await updatePoint(row.id, row.input)
        } catch (caught) {
          failures.value.push({ ...row, error: describeError(caught) })
        }
        completed.value += 1
      }
    } finally {
      busy.value = false
    }
  }
  return { busy, completed, failures, save }
}
