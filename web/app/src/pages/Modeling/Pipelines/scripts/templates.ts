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

import { deviceAnomalyGraph } from './anomalyTemplates'
import { dailyEnergyGraph } from './energyTemplates'
import { shortTermLoadGraph } from './loadTemplates'
import { ENERGY_RULE_TEMPLATES } from './ruleTemplates'

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
    key: 'daily_energy',
    label: '每日能耗预测（同表）',
    hint: '选择台账，将示例列「计划产量、工单数、能耗」换成实际字段 → 按完整日汇总 → 时序验证 → 发布模型。至少准备 35 个完整日；能耗须为期间用量，预测时提供每日计划数据。',
    build: () => dailyEnergyGraph(),
  },
  {
    key: 'daily_energy_joined',
    label: '每日能耗预测（生产与能耗分表）',
    hint: '分别选择生产、能耗台账和实际字段 → 各自按日汇总 → 同一天精确对齐 → 时序训练评估。发布后按输入签名提供每日计划产量、工单数；可继续增删算子。',
    build: () => dailyEnergyGraph(true),
  },
  {
    key: 'short_term_load',
    label: '短期负荷预测（每半小时）',
    hint: '未来 6 小时，每半小时一个点（12 点）。历史负荷按 6 小时、24 小时、7 天精确对齐，配合计划产量、工单数、预报温度和周期特征。至少准备 42 天历史；负荷为平均功率 kW，发布后逐点提供计划和对应历史负荷。',
    build: shortTermLoadGraph,
  },
  {
    key: 'device_anomaly',
    label: '设备异常检测（正常工况）',
    hint: '选择电流、频率、温度等正常工况样本，无需故障标签。按时间切分，学习多变量关系并校准阈值；发布后第三方输入实时值，检测接口返回是否异常。至少 100 行，建议覆盖代表性工况。',
    build: deviceAnomalyGraph,
  },
  ...ENERGY_RULE_TEMPLATES,
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
