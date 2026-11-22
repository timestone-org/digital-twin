/** @fileoverview 当前导入包的联动补选状态。 */
import { computed, ref, watch } from 'vue'
import type { DashboardExportPayload } from '@dt/contracts'
import { inspectImportInteractions } from '@/features/dashboard/importInteractions'

/** 文件、模板或会话变化时重新确认全部旧引用。 */
export function useInteractionMapping(
  payload: () => DashboardExportPayload | null,
) {
  const choices = ref(new Map<string, string>())
  const review = computed(() => {
    const packed = payload()
    return packed === null ? null : inspectImportInteractions(packed)
  })
  watch(
    payload,
    () => {
      choices.value = new Map()
    },
    { flush: 'sync' },
  )
  const ready = computed(() => {
    const current = review.value
    return (
      current !== null &&
      current.problems.length === 0 &&
      current.references.every(({ value }) => choices.value.has(value))
    )
  })
  const map = computed(() => {
    const references = review.value?.references
    if (!ready.value || references === undefined || references.length === 0)
      return undefined
    return Object.fromEntries(
      references.map(({ value }) => [value, choices.value.get(value) ?? '']),
    )
  })
  function choose(reference: string, key: string): void {
    if (
      review.value?.references.some((item) => item.value === reference) !== true
    )
      return
    if (review.value.options.some((item) => item.value === key))
      choices.value.set(reference, key)
    else choices.value.delete(reference)
  }
  return { choices, review, ready, map, choose }
}
