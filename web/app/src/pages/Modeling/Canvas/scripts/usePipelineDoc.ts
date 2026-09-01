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
import { ref, shallowRef } from 'vue'

import * as modeling from '@/api/modeling'
import { describeError } from '@/composables/useAsyncList'

/** 静态检查一张图。出错时弹一次并给 null。 */
async function checkGraph(
  pipelineId: string,
  graph: ModelingGraph,
  toast: ReturnType<typeof useToast>,
): Promise<ModelingGraphCheck | null> {
  try {
    return await modeling.validateModelingGraph(pipelineId, graph)
  } catch (caught) {
    toast.error(describeError(caught))
    return null
  }
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

export function usePipelineDoc() {
  const pipeline = shallowRef<ModelingPipeline | null>(null)
  const issues = ref<readonly ModelingGraphIssue[]>([])
  const isLoading = ref(false)
  const isSaving = ref(false)
  const error = ref<string | null>(null)
  const toast = useToast()

  async function load(pipelineId: string): Promise<ModelingPipeline | null> {
    isLoading.value = true
    error.value = null
    try {
      const next = await modeling.getModelingPipeline(pipelineId)
      pipeline.value = next
      return next
    } catch (caught) {
      error.value = describeError(caught)
      return null
    } finally {
      isLoading.value = false
    }
  }

  return {
    pipeline,
    issues,
    isLoading,
    isSaving,
    error,
    load,
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
    validate: async (graph: ModelingGraph) => {
      const current = pipeline.value
      if (current === null) return false
      const check = await checkGraph(current.id, graph, toast)
      if (check === null) return false
      issues.value = check.issues
      return check.is_valid
    },
  }
}
