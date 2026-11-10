/** @fileoverview 训练轮询、取消与节点结果读取；发布完成后停止轮询。 */
import type { ModelingNodeRun, ModelingRun } from '@dt/contracts'
import { useToast } from '@dt/ui'
import type { Ref } from 'vue'
import { onBeforeUnmount, ref } from 'vue'

import * as modeling from '@/api/modeling'
import { describeError } from '@/composables/useAsyncList'

import type { PollState } from './runPollState'
import {
  createPollState,
  isSettled,
  schedule,
  stopPolling,
  tick,
} from './runPollState'
import { loadPreview } from './runPreviews'

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

function createStarter(
  state: PollState,
  isStarting: Ref<boolean>,
  toast: Toast,
  watchRun: (run: ModelingRun) => void,
) {
  return async (
    pipelineId: string,
    isKeepingFrames = false,
    autoPublish = false,
  ) => {
    if (state.isDisposed) return
    const generation = state.generation
    isStarting.value = true
    const started = await attempt(
      () =>
        autoPublish
          ? modeling.startModelingRun(
              pipelineId,
              'manual',
              isKeepingFrames,
              true,
            )
          : modeling.startModelingRun(pipelineId, 'manual', isKeepingFrames),
      toast,
    )
    if (generation !== state.generation) return
    isStarting.value = false
    if (started !== null) watchRun(started)
  }
}

export function useRunPolling() {
  const state = createPollState()
  const previews = ref(new Map<string, ModelingNodeRun>())
  const previewErrors = ref(new Map<string, string>())
  const isStarting = ref(false)
  const toast = useToast()

  /** 看某一次运行（发起后、或从历史里选中）。 */
  function watchRun(next: ModelingRun): void {
    if (state.isDisposed) return
    stopPolling(state)
    isStarting.value = false
    state.run.value = next
    previews.value = new Map()
    previewErrors.value = new Map()
    if (!isSettled(next)) schedule(next.id, state)
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
    /** 节点 id → 结果摘要没拉回来的原因。 */
    previewErrors,
    /** 运行状态读不到、界面停在最后一次读数时的原因；null = 读数是新的。 */
    staleReason: state.staleReason,
    isStarting,
    watchRun,
    stop,
    loadPreview: (nodeId: string, isQuiet = false) =>
      loadPreview(
        nodeId,
        isQuiet,
        state,
        { previews, errors: previewErrors },
        toast,
      ),
    /** 现在就重读一次正看着的运行（例如手动发布之后），没跑完的照常接着轮询。 */
    refresh: async () => {
      const current = state.run.value
      if (current === null || state.isDisposed) return
      if (state.timer.value !== null) clearTimeout(state.timer.value)
      state.timer.value = null
      await tick(current.id, state)
    },
    start: createStarter(state, isStarting, toast, watchRun),
    cancel: () => cancel(state, toast),
  }
}
