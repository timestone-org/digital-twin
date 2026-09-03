/**
 * @fileoverview 一条流水线的读、存与静态校验。
 *
 * ⚠ 存图**不带 `Idempotency-Key`**：PATCH 是幂等的，而带上一个新键反而会让
 * 「连点两次保存」被当成两次不同的写（见 `api/modeling.ts`）。
 * ⚠ 校验按的是**画布上当前那张图**，不是库里那份：让用户在保存前就知道图有
 * 没有问题，是这个端点存在的全部理由。
 */
import type {
  ModelingGraph,
  ModelingGraphCheck,
  ModelingGraphIssue,
  ModelingPipeline,
} from '@dt/contracts'
import { useToast } from '@dt/ui'
import type { Ref, ShallowRef } from 'vue'
import { ref, shallowRef } from 'vue'

import * as modeling from '@/api/modeling'
import { describeError } from '@/composables/useAsyncList'
import type { RacedFetch } from '@/composables/useRacedFetch'
import { useRacedFetch } from '@/composables/useRacedFetch'

/** 跑一次校验要碰的那几摊状态。 */
interface CheckDeps {
  pipeline: ShallowRef<ModelingPipeline | null>
  issues: Ref<readonly ModelingGraphIssue[]>
  /** 逐节点的列候选，参数面板的列选择器读它。 */
  knownColumns: Ref<Readonly<Record<string, string[] | null>>>
  toast: ReturnType<typeof useToast>
  raced: RacedFetch
}

/**
 * 静态检查画布上这张图，把问题逐条挂到 `issues` 上。
 *
 * ⚠ 校验的是**画布上当前那张图**，不是库里那份：让用户在保存前就知道图有没有
 * 问题，是这个端点存在的全部理由。
 * ⚠ 边改边校验那一路要 `isQuiet`：每改一笔弹一次 toast 的话，掉线时整屏都是
 * 红条；而按「运行」那一路必须出声，否则用户按了没反应。
 */
async function runCheck(
  deps: CheckDeps,
  graph: ModelingGraph,
  isQuiet: boolean,
): Promise<boolean> {
  const current = deps.pipeline.value
  if (current === null) return false
  let isValid = false
  await deps.raced.run(
    (signal) => modeling.validateModelingGraph(current.id, graph, signal),
    {
      ok: (check: ModelingGraphCheck) => {
        deps.issues.value = check.issues
        deps.knownColumns.value = check.known_columns
        isValid = check.is_valid
      },
      fail: (caught) => {
        if (!isQuiet) deps.toast.error(describeError(caught))
      },
      settled: () => undefined,
    },
  )
  return isValid
}

/** 存图。出错时弹一次并给 null。 */
async function putGraph(
  pipelineId: string,
  graph: ModelingGraph,
  toast: ReturnType<typeof useToast>,
): Promise<ModelingPipeline | null> {
  try {
    const next = await modeling.updateModelingPipeline(pipelineId, { graph })
    toast.success('已保存')
    return next
  } catch (caught) {
    toast.error(describeError(caught))
    return null
  }
}

/** 拉一条流水线。拉不到时把原因留在 `error` 上，不抛。 */
async function fetchPipeline(
  pipelineId: string,
  isLoading: Ref<boolean>,
  error: Ref<string | null>,
): Promise<ModelingPipeline | null> {
  isLoading.value = true
  error.value = null
  try {
    return await modeling.getModelingPipeline(pipelineId)
  } catch (caught) {
    error.value = describeError(caught)
    return null
  } finally {
    isLoading.value = false
  }
}

export function usePipelineDoc() {
  const pipeline = shallowRef<ModelingPipeline | null>(null)
  const issues = ref<readonly ModelingGraphIssue[]>([])
  const knownColumns = ref<Readonly<Record<string, string[] | null>>>({})
  const isLoading = ref(false)
  const isSaving = ref(false)
  const error = ref<string | null>(null)
  const toast = useToast()
  // 边改边校验：慢的那次后返回不许盖掉快的那次，否则问题清单会退回上一版图的
  const checking = useRacedFetch()

  return {
    pipeline,
    issues,
    knownColumns,
    isLoading,
    isSaving,
    error,
    load: async (pipelineId: string) => {
      const next = await fetchPipeline(pipelineId, isLoading, error)
      if (next !== null) pipeline.value = next
      return next
    },
    save: async (graph: ModelingGraph) => {
      const current = pipeline.value
      if (current === null) return false
      isSaving.value = true
      const next = await putGraph(current.id, graph, toast)
      isSaving.value = false
      if (next === null) return false
      pipeline.value = next
      return true
    },
    validate: (graph: ModelingGraph, isQuiet = false) =>
      runCheck(
        { pipeline, issues, knownColumns, toast, raced: checking },
        graph,
        isQuiet,
      ),
    /** 回看历史时清空：问题清单与列候选都是「正在编辑那张图」的。 */
    clearCheck: () => {
      issues.value = []
      knownColumns.value = {}
    },
    /** 离开画布时作废在飞的那一次校验。 */
    stopChecking: () => checking.cancel(),
  }
}
