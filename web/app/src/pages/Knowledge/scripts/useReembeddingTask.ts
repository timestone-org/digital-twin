/** @fileoverview 跟踪当前库最新的整库重嵌任务和已发布索引。 */
import type { KnowledgeReembeddingJob } from '@dt/contracts'
import { onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import { latestReembedding, readReembedding } from '@/api/knowledgeReembedding'
import { describeError } from '@/composables/useAsyncList'
import { useBusyPolling } from '@/composables/useBusyPolling'
import { useRacedFetch } from '@/composables/useRacedFetch'

export function isReembeddingActive(
  job: KnowledgeReembeddingJob | null,
): boolean {
  return job?.status === 'pending' || job?.status === 'running'
}

function newlyPublished(
  previous: KnowledgeReembeddingJob | null,
  next: KnowledgeReembeddingJob | null,
): boolean {
  return (
    next?.status === 'succeeded' &&
    (previous?.id !== next.id || previous.status !== 'succeeded')
  )
}

export function useReembeddingTask(baseId: string, onPublished: () => void) {
  const job = shallowRef<KnowledgeReembeddingJob | null>(null)
  const isLoading = ref(true)
  const error = ref('')
  const reads = useRacedFetch()
  const polling = useBusyPolling(refresh, 3000)

  function display(next: KnowledgeReembeddingJob | null): void {
    const previous = job.value
    job.value = next
    error.value = ''
    polling.sync(isReembeddingActive(next))
    if (newlyPublished(previous, next)) onPublished()
  }

  async function refresh(): Promise<void> {
    const active = job.value
    isLoading.value = true
    await reads.run(
      (signal) =>
        active && isReembeddingActive(active)
          ? readReembedding(baseId, active.id, signal)
          : latestReembedding(baseId, signal),
      {
        ok: display,
        fail: (caught) => {
          error.value = describeError(caught)
        },
        settled: () => {
          isLoading.value = false
        },
      },
    )
  }

  function acceptWrite(next: KnowledgeReembeddingJob): void {
    reads.cancel()
    isLoading.value = false
    display(next)
  }

  onMounted(() => void refresh())
  onBeforeUnmount(reads.cancel)
  return {
    job,
    error,
    isLoading,
    refresh,
    acceptWrite,
    isDisposed: polling.isDisposed,
  }
}
