/**
 * @fileoverview 边改边校验，以及问题清单在界面上的样子。
 *
 * ⚠ 校验必须真的**在编辑期**跑：`:validate` 端点、`issues` 状态与那条提示条在
 * 一期就都有，但全仓零调用——于是列引用、空台账这类问题只有按下「运行」才由
 * 后端拦下，而那条 400 只带一句「流水线还有问题」，逐条定位信息在 toast 里全
 * 丢了（docs/MODELING_DESIGN.md §8.2）。
 */
import type {
  ModelingGraph,
  ModelingGraphIssue,
  ModelingOperator,
} from '@dt/contracts'
import type { ComputedRef, Ref } from 'vue'
import { computed, onBeforeUnmount, shallowRef, watch } from 'vue'

import { issueViewsOf } from './graphIssues'

/** 画布停手多久之后再校验一次。太短会在一串连续提交上打空枪。 */
const DEBOUNCE_MS = 400

export interface GraphIssuesDeps {
  graph: Ref<ModelingGraph>
  operators: ComputedRef<ReadonlyMap<string, ModelingOperator>>
  issues: Ref<readonly ModelingGraphIssue[]>
  /** 回看历史时画布上那张是当时的快照，校验它只会报一堆改不动的问题。 */
  isReplaying: Ref<boolean>
  /** 静默校验一张图。 */
  check: (graph: ModelingGraph) => Promise<unknown>
  /** 作废在飞的那一次校验。 */
  stopChecking: () => void
}

/**
 * 图一变就排一次校验，停手 `DEBOUNCE_MS` 才真发请求。
 *
 * ⚠ 定时器与在飞的那一次都要在卸载时清掉：留着的话，离开画布之后还会打一次
 * 请求并写进一个已经没人看的状态。
 */
export function useGraphIssues(deps: GraphIssuesDeps) {
  const timer = shallowRef<ReturnType<typeof setTimeout> | null>(null)

  function cancel(): void {
    if (timer.value !== null) clearTimeout(timer.value)
    timer.value = null
  }

  function schedule(): void {
    cancel()
    if (deps.isReplaying.value) return
    timer.value = setTimeout(() => {
      timer.value = null
      void deps.check(deps.graph.value)
    }, DEBOUNCE_MS)
  }

  watch(() => deps.graph.value, schedule)
  onBeforeUnmount(() => {
    cancel()
    deps.stopChecking()
  })

  return {
    /** 问题清单在界面上的样子，含定位到哪张卡片。 */
    views: computed(() =>
      issueViewsOf(deps.issues.value, deps.graph.value, deps.operators.value),
    ),
    cancel,
  }
}
