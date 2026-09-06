/**
 * @fileoverview 结果弹窗那一摊：开在哪个节点上、详情从哪来、每一路叫什么。
 *
 * ⚠ 小标题取算子声明的端口标签而不是裸端口名：多路输出的那几步（切分给训练集
 * 与测试集、回归给模型与打分）弹窗里要摆两块，印 `train` / `scored` 读不出那
 * 是什么。
 */
import type {
  ModelingGraph,
  ModelingNodeRun,
  ModelingOperator,
} from '@dt/contracts'
import type { ComputedRef, Ref } from 'vue'
import { computed, ref } from 'vue'

export interface ResultPanelDeps {
  graph: Ref<ModelingGraph>
  operators: ComputedRef<ReadonlyMap<string, ModelingOperator>>
  /**
   * 拿一个节点已经缓存下来的详情；还没拉到就给 undefined。
   *
   * ⚠ 给的是整份详情而不是只给摘要：结果面还要它的讲解（`report`）、拟合参数
   * （`fitted`）、留没留全量结果、摘要有没有被预算削过，一样一样传等于把同一
   * 份东西拆开走四条路。
   */
  nodeRunOf: (nodeId: string) => ModelingNodeRun | undefined
  /** 按需拉一个节点的详情。 */
  loadPreview: (nodeId: string) => Promise<void>
  /**
   * 这次运行冻结下来的那张图；还没跑过给 null。
   *
   * ⚠ 与 `graph` 分开：结果面的公式要照当时那份参数代实参，拿画布上现在这份
   * 的话，改过参数再回看历史会印出一串看着完全正常的假账（规格 §6）。
   */
  runGraph: () => ModelingGraph | null
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

  /** 开着那个节点在这次运行里的参数快照；取不到就是空的。 */
  const config = computed<Record<string, unknown>>(() => {
    const found = deps
      .runGraph()
      ?.nodes.find((item) => item.id === nodeId.value)
    return found?.config ?? {}
  })

  return {
    labels,
    config,
    /** 当前开着的是哪个节点。⚠ 下载地址要用它，别从详情里反推。 */
    nodeId: computed(() => nodeId.value),
    /** 这个节点的详情；null = 还没拉回来。 */
    detail: computed(() =>
      nodeId.value === null ? null : (deps.nodeRunOf(nodeId.value) ?? null),
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
