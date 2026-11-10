/** @fileoverview 节点结果摘要的按需读取：拉过就缓存，后台预取失败只记原因。 */
import type { ModelingNodeRun } from '@dt/contracts'
import type { useToast } from '@dt/ui'
import type { Ref } from 'vue'

import * as modeling from '@/api/modeling'
import { describeError } from '@/composables/useAsyncList'
import { useRacedFetch } from '@/composables/useRacedFetch'

import type { PollState } from './runPollState'

type Toast = ReturnType<typeof useToast>

/** 节点结果的缓存与失败原因，换运行时一起清。 */
export interface PreviewCache {
  previews: Ref<Map<string, ModelingNodeRun>>
  errors: Ref<Map<string, string>>
}

function withError(
  errors: Ref<Map<string, string>>,
  nodeId: string,
  message: string | null,
): void {
  const next = new Map(errors.value)
  if (message === null) next.delete(nodeId)
  else next.set(nodeId, message)
  errors.value = next
}

/**
 * 拉一个节点的结果摘要。**拉过就缓存**，不随轮询重复拉。
 * @param isQuiet 后台预取：失败不弹提示，失败过的也不再重拉，只记下原因
 */
export async function loadPreview(
  nodeId: string,
  isQuiet: boolean,
  state: PollState,
  cache: PreviewCache,
  toast: Toast,
): Promise<void> {
  const current = state.run.value
  if (
    state.isDisposed ||
    current === null ||
    cache.previews.value.has(nodeId) ||
    state.previewLoads.has(nodeId) ||
    (isQuiet && cache.errors.value.has(nodeId))
  )
    return
  if (cache.errors.value.has(nodeId)) withError(cache.errors, nodeId, null)
  // 不同节点可并发；每个节点各用一份守卫，换运行统一取消。
  const request = useRacedFetch()
  state.previewLoads.set(nodeId, request)
  await request.run(
    (signal) => modeling.getModelingNodeRun(current.id, nodeId, signal),
    {
      ok: (detail) => {
        cache.previews.value = new Map(cache.previews.value).set(nodeId, detail)
      },
      fail: (caught) => {
        const message = describeError(caught)
        withError(cache.errors, nodeId, message)
        if (!isQuiet) toast.error(message)
      },
      settled: () => {
        state.previewLoads.delete(nodeId)
      },
    },
  )
}
