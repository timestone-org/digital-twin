/**
 * @fileoverview 盯着一次运行：起、轮询、取消，以及节点结果的按需拉取。
 *
 * ⚠ 轮询必须**在终态停下**：跑完了还每秒打一次，一个开着的画布就能在一夜里
 * 打出几万次请求（MODELING_DESIGN §9.5）。
 * ⚠ 读取统一走useRacedFetch：换运行或卸载取消在飞读取及其回调。
 * ⚠ 停表之后不许再排下一拍：即便传输忽略AbortSignal，作废的回调也不调度。
 * 写入的start/cancel回执另用生命周期代次，已经发送的写入不自动重试。
 */
import type { ModelingNodeRun, ModelingRun } from '@dt/contracts'
import { useToast } from '@dt/ui'
import type { Ref, ShallowRef } from 'vue'
import { onBeforeUnmount, ref, shallowRef } from 'vue'

import * as modeling from '@/api/modeling'
import { describeError } from '@/composables/useAsyncList'
import { useRacedFetch } from '@/composables/useRacedFetch'
import type { RacedFetch } from '@/composables/useRacedFetch'

/** 轮询间隔。运行是秒级的，再密只是多打请求。 */
const POLL_MS = 1000

/** 已经跑完的状态，看到就停表。 */
const SETTLED = new Set(['succeeded', 'failed', 'cancelled'])

interface PollState {
  generation: number
  run: ShallowRef<ModelingRun | null>
  timer: ShallowRef<ReturnType<typeof setTimeout> | null>
  polling: RacedFetch
  previewLoads: Map<string, RacedFetch>
  isDisposed: boolean
}

function stopPolling(state: PollState): void {
  state.generation += 1
  if (state.timer.value !== null) clearTimeout(state.timer.value)
  state.timer.value = null
  state.polling.cancel()
  for (const request of state.previewLoads.values()) request.cancel()
  state.previewLoads.clear()
}

function schedule(runId: string, state: PollState): void {
  state.timer.value = setTimeout(() => void tick(runId, state), POLL_MS)
}

async function tick(runId: string, state: PollState): Promise<void> {
  await state.polling.run((signal) => modeling.getModelingRun(runId, signal), {
    ok: (next) => {
      state.run.value = next
      if (SETTLED.has(next.status)) stopPolling(state)
    },
    fail: () => undefined,
    // cancel作废回调后不会再排一拍，包括忽略signal而迟到的成功回包。
    settled: () => {
      if (state.run.value?.id === runId && !SETTLED.has(state.run.value.status))
        schedule(runId, state)
    },
  })
}

type Toast = ReturnType<typeof useToast>

/** 接口出错时统一弹一次，拿不到就给 null。 */
async function attempt<T>(
  task: () => Promise<T>,
  toast: Toast,
): Promise<T | null> {
  try {
    return await task()
  } catch (caught) {
    toast.error(describeError(caught))
    return null
  }
}

/** 拉一个节点的结果摘要。**拉过就缓存**，不随轮询重复拉。 */
async function loadPreview(
  nodeId: string,
  state: PollState,
  previews: Ref<Map<string, ModelingNodeRun>>,
  toast: Toast,
): Promise<void> {
  const current = state.run.value
  if (
    state.isDisposed ||
    current === null ||
    previews.value.has(nodeId) ||
    state.previewLoads.has(nodeId)
  )
    return
  // 不同节点可并发；每个节点各用一份守卫，换运行统一取消。
  const request = useRacedFetch()
  state.previewLoads.set(nodeId, request)
  await request.run(
    (signal) => modeling.getModelingNodeRun(current.id, nodeId, signal),
    {
      ok: (detail) => {
        previews.value = new Map(previews.value).set(nodeId, detail)
      },
      fail: (caught) => toast.error(describeError(caught)),
      settled: () => {
        state.previewLoads.delete(nodeId)
      },
    },
  )
}

/** 请求取消。回执只是「已受理」，故轮询继续，等它真停。 */
async function cancel(state: PollState, toast: Toast): Promise<void> {
  const current = state.run.value
  if (current === null) return
  const generation = state.generation
  const next = await attempt(
    () => modeling.cancelModelingRun(current.id),
    toast,
  )
  if (next !== null && generation === state.generation) {
    state.run.value = next
    toast.info('已请求取消，当前这一步跑完就会停')
  }
}

/** 各节点预览独立读取，停表统一释放。 */
function createPollState(): PollState {
  return {
    generation: 0,
    run: shallowRef<ModelingRun | null>(null),
    timer: shallowRef<ReturnType<typeof setTimeout> | null>(null),
    polling: useRacedFetch(),
    previewLoads: new Map(),
    isDisposed: false,
  }
}

export function useRunPolling() {
  const state = createPollState()
  const previews = ref(new Map<string, ModelingNodeRun>())
  const isStarting = ref(false)
  const toast = useToast()

  /** 看某一次运行（发起后、或从历史里选中）。 */
  function watchRun(next: ModelingRun): void {
    if (state.isDisposed) return
    stopPolling(state)
    isStarting.value = false
    state.run.value = next
    previews.value = new Map()
    if (!SETTLED.has(next.status)) schedule(next.id, state)
  }

  function stop(): void {
    stopPolling(state)
    isStarting.value = false
  }

  onBeforeUnmount(() => {
    state.isDisposed = true
    stop()
  })

  return {
    run: state.run,
    previews,
    isStarting,
    watchRun,
    stop,
    loadPreview: (nodeId: string) =>
      loadPreview(nodeId, state, previews, toast),
    /**
     * 发起一次运行。
     *
     * ⚠ `isKeepingFrames` 默认关：开着会让每一次运行都往对象存储写几十 MB，
     * 而绝大多数运行只是在调参数（docs/MODELING_PLATFORM_DESIGN.md D12）。
     */
    start: async (pipelineId: string, isKeepingFrames = false) => {
      if (state.isDisposed) return
      const generation = state.generation
      isStarting.value = true
      const started = await attempt(
        () => modeling.startModelingRun(pipelineId, 'manual', isKeepingFrames),
        toast,
      )
      if (generation !== state.generation) return
      isStarting.value = false
      if (started !== null) watchRun(started)
    },
    cancel: () => cancel(state, toast),
  }
}
