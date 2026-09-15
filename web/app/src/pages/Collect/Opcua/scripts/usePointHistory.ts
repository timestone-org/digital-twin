/** @fileoverview 点位详情的有界历史查询；窗口切换作废旧请求。 */
import { computed, ref, watch, onBeforeUnmount, type Ref } from 'vue'
import type { CollectPoint, CollectHistoryAggregate } from '@dt/contracts'
import { pointHistorySeries } from './pointHistorySeries'
import { fetchPointAggregate } from '@/api/pointHistories'
import { describeError } from '@/composables/useAsyncList'
import { useRacedFetch } from '@/composables/useRacedFetch'

export const HISTORY_WINDOWS = [
  { value: '15', label: '最近 15 分钟' },
  { value: '60', label: '最近 1 小时' },
  { value: '1440', label: '最近 24 小时' },
]

export function usePointHistory(point: Ref<CollectPoint | null>) {
  const windowMinutes = ref('60')
  const aggregate = ref('avg')
  const result = ref<CollectHistoryAggregate | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const raced = useRacedFetch()
  onBeforeUnmount(raced.cancel)
  async function reload(): Promise<void> {
    raced.cancel()
    result.value = null
    error.value = null
    loading.value = false
    const target = point.value
    if (target === null || !['float', 'int'].includes(target.data_type)) return
    loading.value = true
    await raced.run(
      (signal) =>
        readHistory(
          target.node_key,
          windowMinutes.value,
          aggregate.value,
          signal,
        ),
      {
        ok: (value) => (result.value = value),
        fail: (caught) => (error.value = describeError(caught)),
        settled: () => (loading.value = false),
      },
    )
  }
  watch(
    [() => point.value?.node_key, windowMinutes, aggregate],
    () => {
      void reload()
    },
    { immediate: true },
  )
  const series = computed(() => pointHistorySeries(point.value, result.value))
  return { windowMinutes, aggregate, result, loading, error, series, reload }
}

function readHistory(
  nodeKey: string,
  minutesText: string,
  aggregate: string,
  signal: AbortSignal,
) {
  const minutes = Number(minutesText)
  const toMs = Date.now()
  return fetchPointAggregate(
    {
      nodeKeys: [nodeKey],
      fromMs: toMs - minutes * 60_000,
      toMs,
      interval: minutes <= 60 ? '1m' : '15m',
      aggregate,
    },
    signal,
  )
}
