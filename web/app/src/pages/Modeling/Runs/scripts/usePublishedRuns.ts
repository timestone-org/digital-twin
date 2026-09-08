/**
 * @fileoverview 运行记录页的已发布状态：翻完版本分页，并在发布回执到达时即时收敛。
 */
import { ref, shallowRef } from 'vue'

import * as modeling from '@/api/modeling'
import { describeError } from '@/composables/useAsyncList'
import { useRacedFetch } from '@/composables/useRacedFetch'

export function usePublishedRuns() {
  const runIds = shallowRef<ReadonlySet<string>>(new Set())
  const loading = ref(false)
  const error = ref<string | null>(null)
  const raced = useRacedFetch()

  async function reload(): Promise<void> {
    loading.value = true
    error.value = null
    await raced.run((signal) => modeling.listAllModelingVersions(signal), {
      ok: (versions) => {
        runIds.value = new Set(versions.map((version) => version.run_id))
      },
      fail: (caught) => (error.value = describeError(caught)),
      settled: () => (loading.value = false),
    })
  }

  function add(runId: string): void {
    runIds.value = new Set(runIds.value).add(runId)
  }

  return { runIds, loading, error, reload, add, cancel: raced.cancel }
}
