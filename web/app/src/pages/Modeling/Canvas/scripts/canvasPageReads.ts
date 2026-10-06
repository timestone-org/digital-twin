/** @fileoverview 建模画布整段加载、历史读取和恢复的竞态边界。 */
import type {
  ModelingGraph,
  ModelingOperator,
  ModelingRunSummary,
} from '@dt/contracts'
import type { useToast } from '@dt/ui'
import type { Ref, ShallowRef } from 'vue'

import * as modeling from '@/api/modeling'
import { describeError } from '@/composables/useAsyncList'
import type { RacedFetch } from '@/composables/useRacedFetch'

import type { useCanvasSelection } from './useCanvasSelection'
import type { useModelingGraph } from './useModelingGraph'
import type { usePipelineDoc } from './usePipelineDoc'
import type { useRunPolling } from './useRunPolling'

/** 历史列表一次读取50项，保持现有分页口径。 */
const RUN_PAGE_SIZE = 50

/** 拉取失败也给空列表；错误仅由仍有效的请求回调提示。 */
async function fetchRuns(
  pipelineId: string,
  signal: AbortSignal,
): Promise<{ items: readonly ModelingRunSummary[]; error: string | null }> {
  try {
    const page = await modeling.listModelingRuns(
      pipelineId,
      { size: RUN_PAGE_SIZE },
      signal,
    )
    return { items: page.items, error: null }
  } catch (caught) {
    return { items: [], error: describeError(caught) }
  }
}

/** 页面手上那几摊状态，三个动作都在它上面操作。 */
export interface PageState {
  doc: ReturnType<typeof usePipelineDoc>
  graph: ReturnType<typeof useModelingGraph>
  selection: ReturnType<typeof useCanvasSelection>
  runner: ReturnType<typeof useRunPolling>
  operators: ShallowRef<readonly ModelingOperator[]>
  runs: Ref<readonly ModelingRunSummary[]>
  isReplaying: Ref<boolean>
  isOpening: Ref<boolean>
  toast: ReturnType<typeof useToast>
  loading: RacedFetch
  replaying: RacedFetch
  history: RacedFetch
  isDisposed: boolean
}

/** 运行列表的迟到响应不能覆盖下一条流水线。 */
export async function loadCanvasRuns(
  state: PageState,
  pipelineId: string,
): Promise<void> {
  if (state.isDisposed) return
  await state.history.run((signal) => fetchRuns(pipelineId, signal), {
    ok: (history) => {
      state.runs.value = history.items
      if (history.error !== null) state.toast.error(history.error)
    },
    fail: (caught) => state.toast.error(describeError(caught)),
    settled: () => undefined,
  })
}

/** 进页面：只由仍有效的整体读取应用目录、文档及历史。 */
export async function openCanvasPage(
  state: PageState,
  pipelineId: string,
): Promise<boolean> {
  if (state.isDisposed) return false
  state.isOpening.value = true
  state.history.cancel()
  backToEditing(state, null)
  let isLoaded = false
  await state.loading.run(
    (signal) =>
      Promise.all([
        modeling.listModelingOperators(signal).catch(() => []),
        state.doc.load(pipelineId),
        fetchRuns(pipelineId, signal),
      ]),
    {
      ok: ([catalog, loaded, history]) => {
        if (loaded === null) return
        state.operators.value = catalog
        state.runs.value = history.items
        if (history.error !== null) state.toast.error(history.error)
        state.graph.reset(loaded.graph)
        isLoaded = true
        void state.doc.validate(loaded.graph, true)
      },
      fail: (caught) => state.toast.error(describeError(caught)),
      settled: () => {
        state.isOpening.value = false
      },
    },
  )
  return isLoaded
}

/** 历史运行必须属于当前流水线，且仍是最后一次恢复请求。 */
export async function replayCanvasRun(
  state: PageState,
  runId: string,
): Promise<void> {
  const pipelineId = state.doc.pipeline.value?.id
  if (state.isDisposed || pipelineId === undefined) return
  await state.replaying.run(
    (signal) => modeling.getModelingRun(runId, signal),
    {
      ok: (picked) => {
        if (
          picked.pipeline_id !== pipelineId ||
          state.doc.pipeline.value?.id !== pipelineId
        ) {
          state.toast.warning('这次运行不属于当前流水线')
          return
        }
        state.selection.clear()
        state.isReplaying.value = true
        state.doc.clearCheck()
        state.graph.reset(picked.graph)
        state.runner.watchRun(picked)
      },
      fail: (caught) => state.toast.error(describeError(caught)),
      settled: () => undefined,
    },
  )
}

/** 回到「在编辑当前这版图」的状态。 */
export function backToEditing(
  state: PageState,
  current: ModelingGraph | null,
): void {
  state.replaying.cancel()
  state.runner.stop()
  state.runner.run.value = null
  state.isReplaying.value = false
  state.selection.clear()
  state.graph.reset(current)
}
