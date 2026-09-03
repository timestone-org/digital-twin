/**
 * @fileoverview 图校验问题的显示口径：一条问题该落在哪张卡片上、显示成哪句话。
 *
 * ⚠ 问题必须能**定位到节点**：后端把 `node_id` / `edge_id` 一路带上来，界面上
 * 只把 `message` 拼成一串的话，用户读到「参数「处理哪些列」里的列「F1」上游
 * 没有」也不知道该去动哪一张卡片——一条长流水线上叫这个名字的参数有好几个。
 */
import type {
  ModelingGraph,
  ModelingGraphIssue,
  ModelingOperator,
} from '@dt/contracts'

/** 一条问题在界面上的样子。 */
export interface IssueView {
  /** `v-for` 的 key。⚠ 不能用下标：删中间一条会让其余整体错位。 */
  key: string
  /** 点这一条要选中哪张卡片；整图级问题给空串。 */
  nodeId: string
  /** 卡片的显示名；整图级问题给空串。 */
  where: string
  message: string
}

/** 一个节点在界面上的显示名，与卡片标题同一份口径。 */
function titleOf(
  graph: ModelingGraph,
  operators: ReadonlyMap<string, ModelingOperator>,
  nodeId: string,
): string {
  const node = graph.nodes.find((item) => item.id === nodeId)
  if (node === undefined) return ''
  return node.alias || operators.get(node.operator)?.name || node.operator
}

/** 把后端那份问题清单折成界面要的形状。 */
export function issueViewsOf(
  issues: readonly ModelingGraphIssue[],
  graph: ModelingGraph,
  operators: ReadonlyMap<string, ModelingOperator>,
): IssueView[] {
  const seen = new Map<string, number>()
  return issues.map((issue) => {
    const base = `${issue.node_id}|${issue.edge_id}|${issue.message}`
    const times = (seen.get(base) ?? 0) + 1
    seen.set(base, times)
    return {
      key: `${base}#${times}`,
      nodeId: issue.node_id,
      where:
        issue.node_id === '' ? '' : titleOf(graph, operators, issue.node_id),
      message: issue.message,
    }
  })
}
