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
  ModelingRunSummary,
} from '@dt/contracts'
import { useToast } from '@dt/ui'
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'

import { useRacedFetch } from '@/composables/useRacedFetch'

import {
  backToEditing,
  loadCanvasRuns,
  openCanvasPage,
  replayCanvasRun,
} from './canvasPageReads'
import type { PageState } from './canvasPageReads'
import { headlineFromPayload } from './nodeHeadline'
import type { NodeRuntime } from './nodeState'
import { stateOf } from './nodeState'
import { useGraphIssues } from './useGraphIssues'
import { useCanvasSelection } from './useCanvasSelection'
import { useModelingGraph } from './useModelingGraph'
import { usePipelineDoc } from './usePipelineDoc'
import { useRunPolling } from './useRunPolling'

/**
 * 一轮运行最多替用户预取这么多份结果摘要。
 *
 * ⚠ 必须封顶：卡片上那行数字要靠摘要才算得出来，但每份摘要最大 256KB，一条
 * 几十个节点的流水线全预取会一口气拉下十几兆。
 */
const MAX_PREFETCH = 24

/** 算子目录按代码索引供参数面板查找。 */
function operatorsOf(
  operators: readonly ModelingOperator[],
): ReadonlyMap<string, ModelingOperator> {
  return new Map(operators.map((item) => [item.code, item]))
}

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

/** GET各路径独立竞态闸，写动作仍使用各自生命周期。 */
function createPageState(): PageState {
  return {
    doc: usePipelineDoc(),
    graph: useModelingGraph(),
    selection: useCanvasSelection(),
    runner: useRunPolling(),
    operators: shallowRef<readonly ModelingOperator[]>([]),
    runs: ref<readonly ModelingRunSummary[]>([]),
    isReplaying: ref(false),
    isOpening: ref(false),
    toast: useToast(),
    loading: useRacedFetch(),
    replaying: useRacedFetch(),
    history: useRacedFetch(),
    isDisposed: false,
  }
}

function disposePage(state: PageState): void {
  state.isDisposed = true
  state.loading.cancel()
  state.replaying.cancel()
  state.history.cancel()
}

export function useCanvasPage() {
  const state = createPageState()
  onBeforeUnmount(() => disposePage(state))

  const operatorMap = computed(() => operatorsOf(state.operators.value))
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
    loadRuns: (pipelineId: string) => loadCanvasRuns(state, pipelineId),
    open: (pipelineId: string) => openCanvasPage(state, pipelineId),
    replay: (runId: string) => replayCanvasRun(state, runId),
    backToEditing: (current: ModelingGraph | null) =>
      backToEditing(state, current),
    /** 问题清单在界面上的样子。 */
    issueViews: check.views,
    /** 离开画布 / 起一次运行之前，把排着的那次边改边校验作废。 */
    stopChecking: check.cancel,
  }
}
