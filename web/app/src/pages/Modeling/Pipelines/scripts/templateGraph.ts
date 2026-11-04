/** @fileoverview 设计模板的节点、端口连线与监督训练链布局。 */
import type {
  ModelingGraph,
  ModelingGraphEdge,
  ModelingGraphNode,
} from '@dt/contracts'

/** 节点在画布上的横向间距与起点。⚠ 坐标是 `left`/`top` 不是 `x`/`y`——
写成后者时对象字面量整个变成错误类型，而 typecheck 只报一处、lint 报在
**用到它的地方**，两边都指不到这里。 */
const STEP_X = 320
const ORIGIN = { left: 80, top: 200 }

export interface PipelineTemplate {
  key: string
  label: string
  hint: string
  build: () => ModelingGraph
}

export function bdmSourceConfig(since = '-30d'): Record<string, unknown> {
  return {
    kind: 'point',
    identifiers: [],
    since,
    value_type: 'number',
  }
}

export function node(
  id: string,
  operator: string,
  at: number,
  config: Record<string, unknown> = {},
): ModelingGraphNode {
  return {
    id,
    operator,
    alias: '',
    config,
    position: { left: ORIGIN.left + at * STEP_X, top: ORIGIN.top },
  }
}

export function edge(
  id: string,
  from: string,
  fromPort: string,
  to: string,
  toPort: string,
): ModelingGraphEdge {
  return {
    id,
    from_node: from,
    from_port: fromPort,
    to_node: to,
    to_port: toPort,
  }
}

/** 一条「取数 → 预处理 → 切分 → 建模 → 评估」的直链。 */
export function chain(
  steps: readonly (readonly [string, string])[],
  model: string,
  evaluator: string,
): ModelingGraph {
  const nodes = steps.map(([id, operator], at) =>
    node(id, operator, at, operator === 'bdm_source' ? bdmSourceConfig() : {}),
  )
  const edges = steps
    .slice(1)
    .map(([id], at) =>
      edge(`e${at + 1}`, steps[at]?.[0] ?? '', 'frame', id, 'frame'),
    )
  const split = steps[steps.length - 1]?.[0] ?? ''
  const at = steps.length
  return {
    format_version: '1.0',
    nodes: [...nodes, node('m', model, at), node('v', evaluator, at + 1)],
    edges: [
      ...edges,
      edge('et', split, 'train', 'm', 'train'),
      edge('ee', split, 'test', 'm', 'test'),
      edge('ev', 'm', 'scored', 'v', 'scored'),
    ],
  }
}
