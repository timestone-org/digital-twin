/** @fileoverview 一屏共享的台账最新值缓存，按分钟刷新并暂停隐藏或失活页面。 */
import type { BindingView, DatasetBindingDetail } from '@dt/contracts'
import type { BindingSlot } from '@dt/runtime'
import { computed, onScopeDispose, ref, shallowRef, watch } from 'vue'

import {
  canRetainDatasetLatest,
  readDatasetLatest,
  type DatasetLatestValue,
} from '@/api/datasetLatest'
import { useWorkspacePage } from '@/features/workspace/context'
import type { ReadDatasetValue } from '@/runtime/bindingReader'
import { isCurrentCalendarDay } from '@/utils/calendarDay'

import { useRacedFetch } from './useRacedFetch'

const REFRESH_MS = 60_000
const PENDING: BindingSlot = { state: 'pending' }
const PUBLIC_MESSAGE = '公开大屏不提供台账数据，请登录后查看'

/** 从绑定清单提取去重台账列身份。 */
function datasetKeys(bindings: readonly BindingView[]): string[] {
  return [
    ...new Set(
      bindings.flatMap((binding) => {
        const detail = binding.detailJson
        return binding.sourceKind === 'dataset' &&
          detail !== null &&
          'datasetKey' in detail
          ? [detail.datasetKey]
          : []
      }),
    ),
  ].sort()
}

/** 装配页面内最新值；匿名公开页显式禁止进入认证 API。 */
export function useDatasetLatestValues(
  bindings: () => readonly BindingView[],
  scope: () => string,
  isEnabled = true,
): ReadDatasetValue {
  const keys = computed(() => datasetKeys(bindings()))
  const values = shallowRef<ReadonlyMap<string, DatasetLatestValue>>(new Map())
  const nowMs = ref(Date.now())
  const fetch = useRacedFetch()

  function refresh(): void {
    nowMs.value = Date.now()
    const wanted = keys.value
    void fetch.run((signal) => readDatasetLatest(wanted, signal), {
      ok: (result) => {
        values.value = retainLastValues(result, values.value)
      },
      fail: (caught) => {
        values.value = retainLastValues(
          failedValues(wanted, caught),
          values.value,
        )
      },
      settled: () => undefined,
    })
  }

  watch(
    scope,
    () => {
      values.value = new Map()
    },
    { flush: 'sync' },
  )
  useLatestRefresh({
    signature: () => `${scope()}\n${keys.value.join('\n')}`,
    canRead: () => isEnabled && scope() !== '' && keys.value.length > 0,
    refresh,
    cancel: fetch.cancel,
  })

  return (key, detail) =>
    isEnabled
      ? latestSlot(values.value.get(key), detail, nowMs.value)
      : { state: 'error', message: PUBLIC_MESSAGE }
}

function latestSlot(
  result: DatasetLatestValue | undefined,
  detail: DatasetBindingDetail | undefined,
  nowMs: number,
): BindingSlot {
  if (result === undefined) return PENDING
  const { slot, staleAtMs } = result
  const dayGuard = guardCalendarDay(slot, detail, nowMs)
  if (dayGuard !== null) return dayGuard
  return slot.state === 'ok' && staleAtMs !== undefined && nowMs > staleAtMs
    ? { ...slot, isStale: true }
    : slot
}

/** 自然日标量不能把昨日最后值作为今日累计继续显示。 */
function guardCalendarDay(
  slot: BindingSlot,
  detail: DatasetBindingDetail | undefined,
  nowMs: number,
): BindingSlot | null {
  if (detail?.range.lastWindow !== 'today' || slot.state !== 'ok') return null
  try {
    return slot.timestampMs !== undefined &&
      isCurrentCalendarDay(slot.timestampMs, nowMs, detail.timezone)
      ? null
      : { state: 'ok', value: null, dependsOnRealtime: false }
  } catch {
    return { state: 'error', message: '当日台账绑定的时区无效' }
  }
}

interface LatestRefresh {
  signature: () => string
  canRead: () => boolean
  refresh: () => void
  cancel: () => void
}

/** 按屏调度，停用与卸载时同时终止在途请求。 */
function useLatestRefresh(options: LatestRefresh): void {
  const page = useWorkspacePage()
  const isVisible = ref(!document.hidden)
  let timer: ReturnType<typeof setInterval> | null = null
  function stop(): void {
    if (timer !== null) clearInterval(timer)
    timer = null
    options.cancel()
  }
  function synchronize(): void {
    stop()
    if (!options.canRead() || !isVisible.value || page?.active.value === false)
      return
    options.refresh()
    timer = setInterval(options.refresh, REFRESH_MS)
  }
  watch(
    () => [options.signature(), isVisible.value, page?.active.value],
    synchronize,
    { immediate: true },
  )
  const followVisibility = (): void => {
    isVisible.value = !document.hidden
  }
  document.addEventListener('visibilitychange', followVisibility)
  onScopeDispose(() => {
    stop()
    document.removeEventListener('visibilitychange', followVisibility)
  })
}

/** 目录失败与逐表失败使用相同的缓存保留边界。 */
function failedValues(
  keys: readonly string[],
  caught: unknown,
): ReadonlyMap<string, DatasetLatestValue> {
  const message = caught instanceof Error ? caught.message : String(caught)
  return new Map(
    keys.map((key) => [
      key,
      {
        slot: { state: 'error', message },
        canRetain: canRetainDatasetLatest(caught),
      },
    ]),
  )
}

/** 读数失败时只保留明确标为陈旧的最后已知值。 */
function retainLastValues(
  next: ReadonlyMap<string, DatasetLatestValue>,
  previous: ReadonlyMap<string, DatasetLatestValue>,
): ReadonlyMap<string, DatasetLatestValue> {
  return new Map(
    [...next].map(([key, result]) => {
      const old = previous.get(key)
      return [
        key,
        result.slot.state === 'error' &&
        result.canRetain === true &&
        old?.slot.state === 'ok'
          ? { ...old, slot: { ...old.slot, isStale: true } }
          : result,
      ]
    }),
  )
}
