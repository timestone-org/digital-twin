/**
 * @fileoverview 新建流水线时的开箱模板。
 *
 * 新建之后画布空空，用户得自己从二十几个算子里想出一条链——这是「起步是一张
 * 白纸」那条病症（docs/MODELING_PLATFORM_DESIGN.md D21）。
 *
 * ⚠ 模板是**前端的一份常量**，不是后端的一张表：它只是「往画布上摆几个节点」
 * 的快捷方式，落库之后与手搭的图没有任何区别。做成后端资源会长出「模板版本」
 * 「模板权限」一整套东西，而它换来的能力是零。
 * ⚠ 每一张都要**能跑**：选完只差「挑一张台账、勾几列」。摆一张缺环的图比不摆
 * 更糟——用户会以为是自己配错了。
 */
import type {
  ModelingGraph,
  ModelingGraphEdge,
  ModelingGraphNode,
} from '@dt/contracts'

/** 节点在画布上的横向间距与起点。⚠ 坐标是 `left`/`top` 不是 `x`/`y`——
写成后者时对象字面量整个变成错误类型，而 typecheck 只报一处、lint 报在
**用到它的地方**，两边都指不到这里。 */
const STEP_X = 220
const ORIGIN = { left: 80, top: 200 }

export interface PipelineTemplate {
  key: string
  label: string
  hint: string
  build: () => ModelingGraph
}

function node(
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

function edge(
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
function chain(
  steps: readonly (readonly [string, string])[],
  model: string,
  evaluator: string,
): ModelingGraph {
  const nodes = steps.map(([id, operator], at) => node(id, operator, at))
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

export const PIPELINE_TEMPLATES: readonly PipelineTemplate[] = [
  {
    key: 'blank',
    label: '空白',
    hint: '自己从算子面板拖。',
    build: () => ({ format_version: '1.0', nodes: [], edges: [] }),
  },
  {
    key: 'regression',
    label: '回归预测',
    hint: '取数 → 填缺失 → 标准化 → 切分 → 线性回归 → 回归评估。预测一个连续量（能耗、产量）。',
    build: () =>
      chain(
        [
          ['s', 'ledger_source'],
          ['f', 'fill_missing'],
          ['z', 'standardize'],
          ['p', 'split_dataset'],
        ],
        'linear_regression',
        'regression_metrics',
      ),
  },
  {
    key: 'tree',
    label: '非线性回归',
    hint: '取数 → 填缺失 → 切分 → 树回归 → 回归评估。关系不是直线时用它（低负荷段的能耗几乎是台阶）。⚠ 树不外推，训练区间之外一律给边界值。',
    build: () =>
      chain(
        [
          ['s', 'ledger_source'],
          ['f', 'fill_missing'],
          ['p', 'split_dataset'],
        ],
        'tree_regressor',
        'regression_metrics',
      ),
  },
  {
    key: 'classification',
    label: '分类判别',
    hint: '取数 → 填缺失 → 标准化 → 切分 → 逻辑回归 → 分类评估。判两档（合格 / 不合格）。',
    build: () =>
      chain(
        [
          ['s', 'ledger_source'],
          ['f', 'fill_missing'],
          ['z', 'standardize'],
          ['p', 'split_dataset'],
        ],
        'logistic_regression',
        'classification_metrics',
      ),
  },
]
