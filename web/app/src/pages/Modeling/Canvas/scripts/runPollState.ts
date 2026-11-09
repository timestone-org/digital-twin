/** @fileoverview 运行状态的一拍一拍轮询：终态不再排、连着失败放慢、4xx 停表标陈旧。 */
import type { ModelingRun } from '@dt/contracts'
import type { Ref, ShallowRef } from 'vue'
import { ref, shallowRef } from 'vue'

import { BizError, TransportError } from '@/api/client'
import * as modeling from '@/api/modeling'
import { describeError } from '@/composables/useAsyncList'
import { useRacedFetch } from '@/composables/useRacedFetch'
import type { RacedFetch } from '@/composables/useRacedFetch'

const POLL_MS = 1000
/** 连着读不到时放慢到的上限。 */
const MAX_BACKOFF_MS = 10_000

const SETTLED = new Set(['succeeded', 'failed', 'cancelled'])
export function isSettled(run: ModelingRun): boolean {
  return SETTLED.has(run.status) && run.publication_status !== 'pending'
}

/** 4xx（超时与限流除外）重试也不会好：运行被删了，或权限被收走了。 */
function isTerminalFailure(caught: unknown): boolean {
  if (!(caught instanceof BizError || caught instanceof TransportError))
    return false
  const { status } = caught
  return status >= 400 && status < 500 && status !== 408 && status !== 429
}

export interface PollState {
  generation: number
  /** 连着读失败的次数，决定下一拍隔多久。 */
  failures: number
  /** 停在旧状态的原因；null = 读数是新的。 */
  staleReason: Ref<string | null>
  run: ShallowRef<ModelingRun | null>
  timer: ShallowRef<ReturnType<typeof setTimeout> | null>
  polling: RacedFetch
  previewLoads: Map<string, RacedFetch>
  isDisposed: boolean
}

export function stopPolling(state: PollState): void {
  state.generation += 1
  state.failures = 0
  state.staleReason.value = null
  if (state.timer.value !== null) clearTimeout(state.timer.value)
  state.timer.value = null
  state.polling.cancel()
  for (const request of state.previewLoads.values()) request.cancel()
  state.previewLoads.clear()
}

export function schedule(runId: string, state: PollState): void {
  const delay = Math.min(
    POLL_MS * 2 ** Math.max(state.failures - 1, 0),
    MAX_BACKOFF_MS,
  )
  state.timer.value = setTimeout(() => void tick(runId, state), delay)
}

/**
 * 问一拍运行状态。
 *
 * ⚠ 跑到终态时不走 `stopPolling`：那会推进代号，把在飞的「再训练一次」与节点
 * 结果读取一并作废；终态只是不再排下一拍。
 */
export async function tick(runId: string, state: PollState): Promise<void> {
  await state.polling.run((signal) => modeling.getModelingRun(runId, signal), {
    ok: (next) => {
      state.run.value = next
      state.failures = 0
      state.staleReason.value = null
    },
    fail: (caught) => {
      state.failures += 1
      if (isTerminalFailure(caught))
        state.staleReason.value = describeError(caught)
    },
    // cancel作废回调后不会再排一拍，包括忽略signal而迟到的成功回包。
    settled: () => {
      if (
        state.run.value?.id === runId &&
        !isSettled(state.run.value) &&
        state.staleReason.value === null
      )
        schedule(runId, state)
    },
  })
}

/** 各节点预览独立读取，停表统一释放。 */
export function createPollState(): PollState {
  return {
    generation: 0,
    failures: 0,
    staleReason: ref<string | null>(null),
    run: shallowRef<ModelingRun | null>(null),
    timer: shallowRef<ReturnType<typeof setTimeout> | null>(null),
    polling: useRacedFetch(),
    previewLoads: new Map(),
    isDisposed: false,
  }
}
