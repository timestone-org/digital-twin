/** @fileoverview 指标绑定目录的按编码分页查询与取消。 */
import type { ModelingBdmIndicators } from '@dt/contracts'
import { computed, onScopeDispose, ref, watch } from 'vue'

import { listModelingBdmIndicators } from '@/api/modeling'
import { describeError } from '@/composables/useAsyncList'
import { useRacedFetch } from '@/composables/useRacedFetch'

export function useBdmIndicators() {
  const code = ref('')
  const appliedCode = ref('')
  const page = ref(1)
  const result = ref<ModelingBdmIndicators | null>(null)
  const isLoading = ref(false)
  const error = ref('')
  const raced = useRacedFetch()
  async function load(): Promise<void> {
    isLoading.value = true
    error.value = ''
    result.value = null
    await raced.run(
      (signal) =>
        listModelingBdmIndicators(
          { page: page.value, code: appliedCode.value },
          signal,
        ),
      {
        ok: (value) => {
          result.value = value
        },
        fail: (caught) => {
          error.value = describeError(caught)
        },
        settled: () => {
          isLoading.value = false
        },
      },
    )
  }
  function search(): void {
    appliedCode.value = code.value.trim()
    if (page.value === 1) void load()
    else page.value = 1
  }
  watch(page, () => void load(), { immediate: true })
  onScopeDispose(() => raced.cancel())
  return {
    code,
    page,
    result,
    isLoading,
    error,
    load,
    search,
    items: computed(() => result.value?.items ?? []),
    total: computed(() => result.value?.total ?? 0),
  }
}
