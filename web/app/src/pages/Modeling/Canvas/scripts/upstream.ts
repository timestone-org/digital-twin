/**
 * @fileoverview 顺着边往上游走：一个节点的列候选，来自它上游那些取数节点选的台账。
 *
 * ⚠ 不能拿「图里所有取数节点」凑数：一条流水线接两张台账时，下游那一支的列
 * 选择器会列出另一支的列名，用户勾了之后要等运行时才报「这一列不存在」。
 */
import type { ModelingGraph, ModelingOperator } from '@dt/contracts'

/** 从某个节点往上游走，收集能到达的全部节点（含它自己）。 */
export function withAncestorsOf(
  graph: ModelingGraph,
  nodeId: string,
): Set<string> {
  const seen = new Set<string>()
  const queue = [nodeId]
  while (queue.length > 0) {
    const current = queue.pop()
    if (current === undefined || seen.has(current)) continue
    seen.add(current)
    for (const edge of graph.edges) {
      if (edge.to_node === current) queue.push(edge.from_node)
    }
  }
  return seen
}

/**
 * 这个节点的列候选该看哪几张台账。
 *
 * @param nodeId 正在配参数的那个节点；给 null 时看整张图
 */
export function sourceTablesFor(
  graph: ModelingGraph,
  operators: ReadonlyMap<string, ModelingOperator>,
  nodeId: string | null,
): string[] {
  const reach = nodeId === null ? null : withAncestorsOf(graph, nodeId)
  const codes = graph.nodes
    .filter((node) => reach === null || reach.has(node.id))
    .filter((node) => operators.get(node.operator)?.category === 'source')
    .map((node) => node.config['table_code'])
    .filter((code): code is string => typeof code === 'string' && code !== '')
  return [...new Set(codes)]
}
