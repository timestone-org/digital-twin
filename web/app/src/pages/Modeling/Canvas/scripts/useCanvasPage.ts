/**
 * @fileoverview 画布页的编排：把文档、图、选中、运行几摊状态接起来。
 *
 * ⚠ 只读来自两个互不相同的原因：**看历史运行**与**没有写权限**。合成一个布尔
 * 会让「有权限的人在看历史」也被劝去申请权限（MODELING_DESIGN §9.2）。
 */
import type {
  ModelingGraph,
  ModelingNodeRun,
  ModelingNodeRunSummary,
  ModelingOperator,
  ModelingRun,
  ModelingRunSummary,
} from '@dt/contracts'
import { useToast } from '@dt/ui'
import type { Ref, ShallowRef } from 'vue'
import { computed, ref, shallowRef, watch } from 'vue'

import * as modeling from '@/api/modeling'
import { describeError } from '@/composables/useAsyncList'

import { headlineFromPayload } from './nodeHeadline'
import type { NodeRuntime } from './nodeState'
import { stateOf } from './nodeState'
import { useGraphIssues } from './useGraphIssues'
import { useCanvasSelection } from './useCanvasSelection'
import { useModelingGraph } from './useModelingGraph'
import { usePipelineDoc } from './usePipelineDoc'
import { useRunPolling } from './useRunPolling'

/** 运行历史一次取这么多。够翻半天了，再多就该做分页了。 */
const RUN_PAGE_SIZE = 50

/**
 * 一轮运行最多替用户预取这么多份结果摘要。
 *
 * ⚠ 必须封顶：卡片上那行数字要靠摘要才算得出来，但每份摘要最大 256KB，一条
 * 几十个节点的流水线全预取会一口气拉下十几兆。
 */
const MAX_PREFETCH = 24

/** 把节点的运行状态摊成画布要的表，顺带算出卡片上那行数字。 */
function runtimeOf(
  nodes: readonly ModelingNodeRunSummary[],
  previews: ReadonlyMap<string, ModelingNodeRun>,
): ReadonlyMap<string, NodeRuntime> {
  const table = new Map<string, NodeRuntime>()
  for (const node of nodes) {
    const detail = previews.get(node.node_id)
    table.set(node.node_id, {
      state: stateOf(node.status),
      errorText: node.error_text ?? '',
      hasResult: node.has_preview || detail !== undefined,
      headline: detail === undefined ? '' : headlineFromPayload(detail.preview),
    })
  }
  return table
}

/** 跑成功的节点顺手把摘要拉回来，卡片上那行数字才有得算。 */
function prefetchPreviews(state: PageState): void {
  const nodes = state.runner.run.value?.nodes ?? []
  let budget = MAX_PREFETCH - state.runner.previews.value.size
  for (const node of nodes) {
    if (budget <= 0) return
    if (node.status !== 'succeeded' || !node.has_preview) continue
    if (state.runner.previews.value.has(node.node_id)) continue
    budget -= 1
    void state.runner.loadPreview(node.node_id)
  }
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
  if (loaded === null) return
  state.graph.reset(loaded.graph)
  // ⚠ 进页面就校一次不等防抖：列候选也来自这一趟，晚 400 毫秒就是「刚打开时
  // 参数面板把台账全部的列都列出来」
  void state.doc.validate(loaded.graph, true)
}

/** 回看一次历史运行：画布换成当时那份图，并切成只读。 */
async function replay(state: PageState, runId: string): Promise<void> {
  const picked = await fetchRun(runId, state.toast)
  if (picked === null) return
  state.selection.clear()
  state.isReplaying.value = true
  state.doc.clearCheck()
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
    runtimeOf(state.runner.run.value?.nodes ?? [], state.runner.previews.value),
  )
  const check = useGraphIssues({
    graph: state.graph.graph,
    operators: operatorMap,
    issues: state.doc.issues,
    isReplaying: state.isReplaying,
    check: (graph) => state.doc.validate(graph, true),
    stopChecking: state.doc.stopChecking,
  })

  // 节点一跑成，就把它的摘要拉回来——卡片上那行数字要靠它
  watch(
    () => state.runner.run.value?.nodes.map((node) => node.status).join(','),
    () => prefetchPreviews(state),
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
    /** 问题清单在界面上的样子。 */
    issueViews: check.views,
    /** 离开画布 / 起一次运行之前，把排着的那次边改边校验作废。 */
    stopChecking: check.cancel,
  }
}
