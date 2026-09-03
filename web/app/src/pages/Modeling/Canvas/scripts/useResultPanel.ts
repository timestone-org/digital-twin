/**
 * @fileoverview 结果弹窗那一摊：开在哪个节点上、摘要从哪来、每一路叫什么。
 *
 * ⚠ 小标题取算子声明的端口标签而不是裸端口名：多路输出的那几步（切分给训练集
 * 与测试集、回归给模型与打分）弹窗里要摆两块，印 `train` / `scored` 读不出那
 * 是什么。
 */
import type { ModelingGraph, ModelingOperator } from '@dt/contracts'
import type { ComputedRef, Ref } from 'vue'
import { computed, ref } from 'vue'

export interface ResultPanelDeps {
  graph: Ref<ModelingGraph>
  operators: ComputedRef<ReadonlyMap<string, ModelingOperator>>
  /** 拿一个节点已经缓存下来的结果摘要；还没拉到就给 undefined。 */
  previewOf: (nodeId: string) => Record<string, unknown> | undefined
  /** 按需拉一个节点的结果摘要。 */
  loadPreview: (nodeId: string) => Promise<void>
  /**
   * 这个节点留下了全量结果的那些端口。
   *
   * ⚠ 摘要那一份**有硬上限**（200 行）：它是给人看一眼的，不是数据。要把
   * 处理好的数据拿走得靠这几个端口上的下载链接
   * （docs/MODELING_PLATFORM_DESIGN.md D12）。
   */
  exportedPortsOf: (nodeId: string) => readonly string[]
}

export function useResultPanel(deps: ResultPanelDeps) {
  const nodeId = ref<string | null>(null)

  const labels = computed<Record<string, string>>(() => {
    const node = deps.graph.value.nodes.find((item) => item.id === nodeId.value)
    if (node === undefined) return {}
    const table: Record<string, string> = {}
    for (const port of deps.operators.value.get(node.operator)?.outputs ?? []) {
      table[port.name] = port.label
    }
    return table
  })

  return {
    labels,
    /** 当前开着的是哪个节点。⚠ 下载地址要用它，别从摘要里反推。 */
    nodeId: computed(() => nodeId.value),
    payload: computed(() =>
      nodeId.value === null ? null : (deps.previewOf(nodeId.value) ?? null),
    ),
    /** 这个节点留下了全量结果的那些端口；没留过就是空。 */
    exportedPorts: computed(() =>
      nodeId.value === null ? [] : deps.exportedPortsOf(nodeId.value),
    ),
    open: async (id: string) => {
      nodeId.value = id
      await deps.loadPreview(id)
    },
    close: () => {
      nodeId.value = null
    },
  }
}
