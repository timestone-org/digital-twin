/** @fileoverview 流水线读取复用竞态守卫，加载时使旧写入代次失效。 */
import type { ModelingPipeline } from '@dt/contracts'
import type { Ref, ShallowRef } from 'vue'

import * as modeling from '@/api/modeling'
import { describeError } from '@/composables/useAsyncList'
import type { RacedFetch } from '@/composables/useRacedFetch'

export interface PipelineLoadDeps {
  pipeline: ShallowRef<ModelingPipeline | null>
  isSaving: Ref<boolean>
  advance: () => number
  isLoading: Ref<boolean>
  error: Ref<string | null>
  checking: RacedFetch
  loading: RacedFetch
}

/** 开始加载即隔离上一资源的保存和校验回执。 */
export function createPipelineLoader(deps: PipelineLoadDeps) {
  return async (pipelineId: string): Promise<ModelingPipeline | null> => {
    deps.advance()
    deps.pipeline.value = null
    deps.isSaving.value = false
    deps.checking.cancel()
    deps.isLoading.value = true
    deps.error.value = null
    let loaded: ModelingPipeline | null = null
    await deps.loading.run(
      (signal) => modeling.getModelingPipeline(pipelineId, signal),
      {
        ok: (next) => {
          deps.pipeline.value = next
          loaded = next
        },
        fail: (caught) => {
          deps.error.value = describeError(caught)
        },
        settled: () => {
          deps.isLoading.value = false
        },
      },
    )
    return loaded
  }
}
