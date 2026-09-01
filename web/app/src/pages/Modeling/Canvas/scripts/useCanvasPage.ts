/**
 * @fileoverview 画布页的编排：把文档、图、选中、运行几摊状态接起来。
 *
 * ⚠ 只读来自两个互不相同的原因：**看历史运行**与**没有写权限**。合成一个布尔
 * 会让「有权限的人在看历史」也被劝去申请权限（MODELING_DESIGN §9.2）。
 */
import type {
  ModelingGraph,
  ModelingNodeRunSummary,
  ModelingOperator,
  ModelingRun,
  ModelingRunSummary,
} from '@dt/contracts'
import { useToast } from '@dt/ui'
import type { Ref, ShallowRef } from 'vue'
import { computed, ref, shallowRef } from 'vue'

import * as modeling from '@/api/modeling'
import { describeError } from '@/composables/useAsyncList'

import type { NodeRuntime } from './nodeState'
import { stateOf } from './nodeState'
import { useCanvasSelection } from './useCanvasSelection'
import { useModelingGraph } from './useModelingGraph'
import { usePipelineDoc } from './usePipelineDoc'
import { useRunPolling } from './useRunPolling'

/** 运行历史一次取这么多。够翻半天了，再多就该做分页了。 */
const RUN_PAGE_SIZE = 50

/** 把节点的运行状态摊成画布要的四态表。 */
function runtimeOf(
  nodes: readonly ModelingNodeRunSummary[],
  hasPreview: ReadonlySet<string>,
): ReadonlyMap<string, NodeRuntime> {
  const table = new Map<string, NodeRuntime>()
  for (const node of nodes) {
    table.set(node.node_id, {
      state: stateOf(node.status),
      errorText: node.error_text ?? '',
      hasResult: node.has_preview || hasPreview.has(node.node_id),
    })
  }
  return table
}

/** 拉一页运行历史。出错时弹一次并给空。 */
async function fetchRuns(
  pipelineId: string,
  toast: ReturnType<typeof useToast>,
): Promise<readonly ModelingRunSummary[]> {
  try {
    const page = await modeling.listModelingRuns(pipelineId, {
      size: RUN_PAGE_SIZE,
    })
    return page.items
  } catch (caught) {
    toast.error(describeError(caught))
    return []
  }
}

/** 取一次运行的详情（含当时那份图）。出错时弹一次并给 null。 */
async function fetchRun(
  runId: string,
  toast: ReturnType<typeof useToast>,
): Promise<ModelingRun | null> {
  try {
    return await modeling.getModelingRun(runId)
  } catch (caught) {
    toast.error(describeError(caught))
    return null
  }
}

/** 页面手上那几摊状态，三个动作都在它上面操作。 */
interface PageState {
  doc: ReturnType<typeof usePipelineDoc>
  graph: ReturnType<typeof useModelingGraph>
  selection: ReturnType<typeof useCanvasSelection>
  runner: ReturnType<typeof useRunPolling>
  operators: ShallowRef<readonly ModelingOperator[]>
  runs: Ref<readonly ModelingRunSummary[]>
  isReplaying: Ref<boolean>
  toast: ReturnType<typeof useToast>
}

/** 进页面：算子目录、流水线、历史三样一起拉。 */
async function open(state: PageState, pipelineId: string): Promise<void> {
  const [catalog, loaded, history] = await Promise.all([
    modeling.listModelingOperators().catch(() => []),
    state.doc.load(pipelineId),
    fetchRuns(pipelineId, state.toast),
  ])
  state.operators.value = catalog
  state.runs.value = history
  if (loaded !== null) state.graph.reset(loaded.graph)
}

/** 回看一次历史运行：画布换成当时那份图，并切成只读。 */
async function replay(state: PageState, runId: string): Promise<void> {
  const picked = await fetchRun(runId, state.toast)
  if (picked === null) return
  state.selection.clear()
  state.isReplaying.value = true
  state.graph.reset(picked.graph)
  state.runner.watchRun(picked)
}

/** 回到「在编辑当前这版图」的状态。 */
function backToEditing(state: PageState, current: ModelingGraph | null): void {
  state.runner.stop()
  state.runner.run.value = null
  state.isReplaying.value = false
  state.selection.clear()
  state.graph.reset(current)
}

export function useCanvasPage() {
  const state: PageState = {
    doc: usePipelineDoc(),
    graph: useModelingGraph(),
    selection: useCanvasSelection(),
    runner: useRunPolling(),
    operators: shallowRef<readonly ModelingOperator[]>([]),
    runs: ref<readonly ModelingRunSummary[]>([]),
    isReplaying: ref(false),
    toast: useToast(),
  }

  const operatorMap = computed(
    () => new Map(state.operators.value.map((item) => [item.code, item])),
  )
  const runtime = computed(() =>
    runtimeOf(
      state.runner.run.value?.nodes ?? [],
      new Set(state.runner.previews.value.keys()),
    ),
  )

  return {
    ...state,
    operatorMap,
    runtime,
    loadRuns: async (pipelineId: string) => {
      state.runs.value = await fetchRuns(pipelineId, state.toast)
    },
    open: (pipelineId: string) => open(state, pipelineId),
    replay: (runId: string) => replay(state, runId),
    backToEditing: (current: ModelingGraph | null) =>
      backToEditing(state, current),
  }
}
