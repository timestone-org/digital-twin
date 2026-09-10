/** @fileoverview 实时卡片的配置重验、订阅、首帧超时和暂停状态。 */
import { computed, inject, onScopeDispose, ref, watch, type Ref } from 'vue'
import type { PointSample } from '@dt/contracts'
import { useRacedFetch, type RacedFetch } from '@/composables/useRacedFetch'
import { useRealtimeChannel } from '@/composables/useRealtimeChannel'
import {
  resolveLivePoint,
  type LivePoint,
} from '@/features/knowledgeChat/liveTools'
import {
  LIVE_SOURCES,
  createLiveSources,
  type LiveSources,
} from './liveSources'

export const FIRST_FRAME_TIMEOUT_MS = 15_000
export const STREAM_TIMEOUT_MS = 45_000
interface State {
  point: Ref<LivePoint>
  enabled: Ref<boolean>
  channel: ReturnType<typeof useRealtimeChannel>
  sources: LiveSources
  raced: RacedFetch
  current: Ref<LivePoint>
  sample: Ref<PointSample | undefined>
  hasFreshSample: Ref<boolean>
  isPaused: Ref<boolean>
  isLoading: Ref<boolean>
  error: Ref<string>
  detach: (() => void) | null
  timer: ReturnType<typeof setTimeout> | null
}

export function useLivePoint(point: Ref<LivePoint>, enabled: Ref<boolean>) {
  const state = createState(point, enabled)
  watch(
    [() => point.value.node_key, enabled, state.isPaused],
    () => {
      void start(state)
    },
    { immediate: true },
  )
  watch(state.channel.isConnected, (connected) => {
    if (!connected) {
      state.hasFreshSample.value = false
      state.sources.clearSamples()
    } else if (state.detach !== null) armTimeout(state)
  })
  onScopeDispose(() => stop(state))
  return {
    current: state.current,
    sample: state.sample,
    error: state.error,
    isLoading: state.isLoading,
    isPaused: state.isPaused,
    isLive: computed(
      () =>
        enabled.value &&
        !state.isPaused.value &&
        state.channel.isConnected.value &&
        state.hasFreshSample.value,
    ),
    isConnected: state.channel.isConnected,
    toggle: () => {
      state.isPaused.value = !state.isPaused.value
    },
    retry: () => start(state),
  }
}

function createState(point: Ref<LivePoint>, enabled: Ref<boolean>): State {
  return {
    point,
    enabled,
    channel: useRealtimeChannel(),
    sources: inject(LIVE_SOURCES, null) ?? createLiveSources(),
    raced: useRacedFetch(),
    current: ref(point.value),
    sample: ref<PointSample>(),
    hasFreshSample: ref(false),
    isPaused: ref(false),
    isLoading: ref(false),
    error: ref(''),
    detach: null,
    timer: null,
  }
}

function stop(state: State): void {
  state.raced.cancel()
  state.detach?.()
  state.detach = null
  if (state.timer !== null) clearTimeout(state.timer)
  state.timer = null
  state.hasFreshSample.value = false
  state.isLoading.value = false
}

function armTimeout(
  state: State,
  timeoutMs = FIRST_FRAME_TIMEOUT_MS,
  message = '尚未收到点位数据，请检查采集运行态、查看权限和实时点位上限',
): void {
  if (state.timer !== null) clearTimeout(state.timer)
  state.timer = setTimeout(
    () => {
      state.hasFreshSample.value = false
      state.error.value = message
    },
    Math.max(0, timeoutMs),
  )
}

async function start(state: State): Promise<void> {
  stop(state)
  state.error.value = ''
  if (state.current.value.node_key !== state.point.value.node_key) {
    state.sample.value = undefined
    state.current.value = state.point.value
  }
  if (!state.enabled.value || state.isPaused.value) return
  state.isLoading.value = true
  await state.raced.run(
    (signal) => resolveLivePoint(state.point.value.node_key, signal),
    {
      ok: (found) => {
        state.current.value = found
        armTimeout(state)
        state.detach = state.sources.subscribe(
          state.channel,
          found.node_key,
          (next, issue) => {
            if (issue) state.error.value = issue
            if (next === undefined) {
              state.hasFreshSample.value = false
              return
            }
            state.sample.value = next.sample
            state.hasFreshSample.value = state.channel.isConnected.value
            state.error.value = ''
            armTimeout(
              state,
              STREAM_TIMEOUT_MS - (Date.now() - next.receivedAtMs),
              '推送已中断，显示最后读数；数据可能过期',
            )
          },
        )
      },
      fail: (caught) => {
        state.error.value =
          caught instanceof Error ? caught.message : '无法读取点位配置'
      },
      settled: () => {
        state.isLoading.value = false
      },
    },
  )
}
