/** @fileoverview 点位替换校验状态，输入改变或关闭时作废旧结果。 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRacedFetch } from '@/composables/useRacedFetch'
import { describeError } from '@/composables/useAsyncList'
import {
  validateReplacementPoints,
  type PointValidation,
} from './pointBatchValidation'
import type { PointReplacement } from './batchConfig'
function isValid(
  checked: string,
  key: string,
  results: readonly PointValidation[],
): boolean {
  return (
    checked === key &&
    results.length > 0 &&
    results.every((result) => result.valid)
  )
}
function failureMessage(caught: unknown): string {
  return caught instanceof Error
    ? caught.message || '校验失败'
    : describeError(caught)
}
export function usePointBatchCheck(
  plan: () => readonly PointReplacement[],
  open: () => boolean,
) {
  const loading = ref(false),
    error = ref(''),
    results = ref<PointValidation[]>([])
  const checked = ref('')
  const key = computed(() => JSON.stringify(plan()))
  const raced = useRacedFetch()
  function cancel(): void {
    raced.cancel()
    loading.value = false
    checked.value = ''
    error.value = ''
    results.value = []
  }
  watch([key, open], cancel)
  onBeforeUnmount(cancel)
  async function check(): Promise<void> {
    if (!open() || plan().length === 0) return
    const snapshot = key.value
    loading.value = true
    error.value = ''
    results.value = []
    checked.value = ''
    await raced.run(
      (signal) =>
        validateReplacementPoints(
          plan().map((row) => row.after),
          signal,
        ),
      {
        ok: (value) => {
          results.value = value
          checked.value = snapshot
        },
        fail: (caught) => {
          error.value = failureMessage(caught)
        },
        settled: () => {
          loading.value = false
        },
      },
    )
  }
  const valid = computed(() => isValid(checked.value, key.value, results.value))
  return { loading, error, results, valid, check }
}
