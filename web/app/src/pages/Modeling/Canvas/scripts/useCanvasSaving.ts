/** @fileoverview 保存与运行共用已发送快照，保留响应期间的新草稿。 */
import { useToast } from '@dt/ui'
import type { Ref } from 'vue'
import { onBeforeUnmount, ref } from 'vue'

import type { useCanvasPage } from './useCanvasPage'

interface RunDeps {
  page: ReturnType<typeof useCanvasPage>
  id: string
  isCurrent: () => boolean
  isKeepingFrames: () => boolean
  toast: ReturnType<typeof useToast>
}

/** 保存、校验和运行都使用捕获的资源及图，不接受已离开的回执。 */
async function runSnapshot(deps: RunDeps): Promise<void> {
  const { page, id, isCurrent, isKeepingFrames, toast } = deps
  const snapshot = page.graph.graph.value
  if (page.graph.isDirty.value && !(await page.doc.save(snapshot))) return
  if (!isCurrent()) return
  page.graph.markSaved(snapshot)
  page.stopChecking()
  const isValid = await page.doc.validate(snapshot)
  if (!isCurrent()) return
  if (!isValid) {
    toast.warning(
      page.issueViews.value[0]?.message ?? '流水线还有问题，先改好再运行',
    )
    return
  }
  await page.runner.start(id, isKeepingFrames())
  if (isCurrent()) await page.loadRuns(id)
}

/** 手动保存只接受发送的快照，不覆盖后来编辑的图。 */
async function saveSnapshot(
  page: ReturnType<typeof useCanvasPage>,
  isCurrent: () => boolean,
): Promise<void> {
  if (page.doc.isSaving.value || !isCurrent()) return
  const snapshot = page.graph.graph.value
  if ((await page.doc.save(snapshot)) && isCurrent())
    page.graph.markSaved(snapshot)
}

/** 离开和卸载时作废保存后的继续动作。 */
function useSavingLifecycle(
  page: ReturnType<typeof useCanvasPage>,
  pipelineId: () => string,
  isPreparingRun: Ref<boolean>,
) {
  let generation = 0
  let isDisposed = false

  function cancel(): void {
    generation += 1
    isPreparingRun.value = false
  }
  function isCurrent(token: number, id: string): boolean {
    return (
      !isDisposed &&
      !page.isOpening.value &&
      token === generation &&
      pipelineId() === id &&
      page.doc.pipeline.value?.id === id
    )
  }
  onBeforeUnmount(() => {
    isDisposed = true
    cancel()
  })
  return { token: () => generation, cancel, isCurrent }
}

/** 同一页面的保存和运行准备串行；编辑仍可继续。 */
export function useCanvasSaving(
  page: ReturnType<typeof useCanvasPage>,
  pipelineId: () => string,
  isKeepingFrames: () => boolean,
) {
  const toast = useToast()
  const isPreparingRun = ref(false)
  const lifecycle = useSavingLifecycle(page, pipelineId, isPreparingRun)

  /** 存图后校验同一快照；失败不运行，也不清掉后续草稿。 */
  async function run(): Promise<void> {
    if (page.doc.isSaving.value || isPreparingRun.value) return
    const token = lifecycle.token()
    const id = pipelineId()
    if (!lifecycle.isCurrent(token, id)) return
    isPreparingRun.value = true
    try {
      await runSnapshot({
        page,
        id,
        isCurrent: () => lifecycle.isCurrent(token, id),
        isKeepingFrames,
        toast,
      })
    } finally {
      if (token === lifecycle.token()) isPreparingRun.value = false
    }
  }

  return {
    isPreparingRun,
    save: () => {
      if (isPreparingRun.value) return Promise.resolve()
      const token = lifecycle.token()
      const id = pipelineId()
      return saveSnapshot(page, () => lifecycle.isCurrent(token, id))
    },
    run,
    cancel: lifecycle.cancel,
  }
}
