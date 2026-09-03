/**
 * @fileoverview 盯着一次运行：起、轮询、取消，以及节点结果的按需拉取。
 *
 * ⚠ 轮询必须**在终态停下**：跑完了还每秒打一次，一个开着的画布就能在一夜里
 * 打出几万次请求（MODELING_DESIGN §9.5）。
 * ⚠ 每一轮都带 `AbortSignal`：换一条运行看时上一轮的回包会晚到，不取消的话
 * 它会把新选中那次的状态盖回去。
 * ⚠ 停表之后**不许再排下一拍**：停表是 abort 在飞的那次，而 abort 让它落进
 * 「一次问失败」那条分支，径直往下排的话，卸载只是让计时器换了个来源。
 */
import type { ModelingNodeRun, ModelingRun } from '@dt/contracts'
import { useToast } from '@dt/ui'
import type { Ref, ShallowRef } from 'vue'
import { onBeforeUnmount, ref, shallowRef } from 'vue'

import * as modeling from '@/api/modeling'
import { describeError } from '@/composables/useAsyncList'

/** 轮询间隔。运行是秒级的，再密只是多打请求。 */
const POLL_MS = 1000

/** 已经跑完的状态，看到就停表。 */
const SETTLED = new Set(['succeeded', 'failed', 'cancelled'])

interface PollState {
  run: ShallowRef<ModelingRun | null>
  timer: ShallowRef<ReturnType<typeof setTimeout> | null>
  inflight: ShallowRef<AbortController | null>
}

function stopPolling(state: PollState): void {
  if (state.timer.value !== null) clearTimeout(state.timer.value)
  state.timer.value = null
  state.inflight.value?.abort()
  state.inflight.value = null
}

function schedule(runId: string, state: PollState): void {
  state.timer.value = setTimeout(() => void tick(runId, state), POLL_MS)
}

async function tick(runId: string, state: PollState): Promise<void> {
  const controller = new AbortController()
  state.inflight.value = controller
  try {
    const next = await modeling.getModelingRun(runId, controller.signal)
    // 换过一次运行之后旧的回包才到，丢掉它
    if (state.run.value !== null && state.run.value.id !== runId) return
    state.run.value = next
    if (SETTLED.has(next.status)) return stopPolling(state)
  } catch {
    // 轮询失败不打断用户：下一拍再试，真出事了会在运行详情里显示
  }
  // ⚠ 被掐掉之后不许再排下一拍：停表走的是 abort，而 abort 让上面那次请求落进
  // catch，径直往下排的话，页面已经卸了轮询还在一秒一次地打，直到刷新为止
  if (controller.signal.aborted) return
  schedule(runId, state)
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
  if (current === null || previews.value.has(nodeId)) return
  const detail = await attempt(
    () => modeling.getModelingNodeRun(current.id, nodeId),
    toast,
  )
  if (detail !== null) {
    previews.value = new Map(previews.value).set(nodeId, detail)
  }
}

/** 请求取消。回执只是「已受理」，故轮询继续，等它真停。 */
async function cancel(state: PollState, toast: Toast): Promise<void> {
  const current = state.run.value
  if (current === null) return
  const next = await attempt(
    () => modeling.cancelModelingRun(current.id),
    toast,
  )
  if (next !== null) {
    state.run.value = next
    toast.info('已请求取消，当前这一步跑完就会停')
  }
}

export function useRunPolling() {
  const state: PollState = {
    run: shallowRef<ModelingRun | null>(null),
    timer: shallowRef<ReturnType<typeof setTimeout> | null>(null),
    inflight: shallowRef<AbortController | null>(null),
  }
  const previews = ref(new Map<string, ModelingNodeRun>())
  const isStarting = ref(false)
  const toast = useToast()

  /** 看某一次运行（发起后、或从历史里选中）。 */
  function watchRun(next: ModelingRun): void {
    stopPolling(state)
    state.run.value = next
    previews.value = new Map()
    if (!SETTLED.has(next.status)) schedule(next.id, state)
  }

  onBeforeUnmount(() => stopPolling(state))

  return {
    run: state.run,
    previews,
    isStarting,
    watchRun,
    stop: () => stopPolling(state),
    loadPreview: (nodeId: string) =>
      loadPreview(nodeId, state, previews, toast),
    /**
     * 发起一次运行。
     *
     * ⚠ `isKeepingFrames` 默认关：开着会让每一次运行都往对象存储写几十 MB，
     * 而绝大多数运行只是在调参数（docs/MODELING_PLATFORM_DESIGN.md D12）。
     */
    start: async (pipelineId: string, isKeepingFrames = false) => {
      isStarting.value = true
      const started = await attempt(
        () => modeling.startModelingRun(pipelineId, 'manual', isKeepingFrames),
        toast,
      )
      isStarting.value = false
      if (started !== null) watchRun(started)
    },
    cancel: () => cancel(state, toast),
  }
}
