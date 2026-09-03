/**
 * @fileoverview 顺着边往上游走：一个节点该拉哪几张台账的列定义。
 *
 * ⚠ 不能拿「图里所有取数节点」凑数：一条流水线接两张台账时，下游那一支的列
 * 选择器会列出另一支的列名，用户勾了之后要等运行时才报「这一列不存在」。
 * ⚠ 这里只管**台账清单**，不管列候选：列由后端算好经 `:validate` 的
 * `known_columns` 给下来。前端曾经另写一份收窄口径，两份各自自洽而真跑起来
 * 对不上（docs/MODELING_PLATFORM_DESIGN.md D2）。
 */
import type { ModelingGraph, ModelingOperator } from '@dt/contracts'

/** 上游的一个取数节点。 */
export interface UpstreamSource {
  nodeId: string
  /** 它选的台账编码。 */
  code: string
  /** 它挑中的列 key。**空数组的语义是「取全部列」**，不是「一列都不取」。 */
  picked: readonly string[]
}

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

function textList(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

/**
 * 这个节点上游（含它自己）的那些取数节点。
 *
 * @param nodeId 正在配参数的那个节点；给 null 时看整张图
 */
export function upstreamSourcesFor(
  graph: ModelingGraph,
  operators: ReadonlyMap<string, ModelingOperator>,
  nodeId: string | null,
): UpstreamSource[] {
  const reach = nodeId === null ? null : withAncestorsOf(graph, nodeId)
  return graph.nodes
    .filter((node) => reach === null || reach.has(node.id))
    .filter((node) => operators.get(node.operator)?.category === 'source')
    .map((node) => ({
      nodeId: node.id,
      code:
        typeof node.config['table_code'] === 'string'
          ? node.config['table_code']
          : '',
      picked: textList(node.config['columns']),
    }))
    .filter((source) => source.code !== '')
}

/** 这个节点的列候选该看哪几张台账。 */
export function sourceTablesFor(
  graph: ModelingGraph,
  operators: ReadonlyMap<string, ModelingOperator>,
  nodeId: string | null,
): string[] {
  return [
    ...new Set(
      upstreamSourcesFor(graph, operators, nodeId).map((item) => item.code),
    ),
  ]
}
