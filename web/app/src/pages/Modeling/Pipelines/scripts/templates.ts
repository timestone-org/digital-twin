/** @fileoverview 新建工作流时默认从能管取数的内置模板；见 docs/MODELING_DESIGN.md。 */
import type { PipelineTemplate } from './templateGraph'
import { chain } from './templateGraph'
import { MODEL_FAMILY_TEMPLATES } from './familyTemplates'
export type { PipelineTemplate } from './templateGraph'

import { deviceAnomalyGraph } from './anomalyTemplates'
import { dailyEnergyGraph } from './energyTemplates'
import { shortTermLoadGraph } from './loadTemplates'
import { ENERGY_RULE_TEMPLATES } from './ruleTemplates'

export const PIPELINE_TEMPLATES: readonly PipelineTemplate[] = [
  {
    key: 'blank',
    label: '空白',
    hint: '自己从算子面板拖。',
    build: () => ({ format_version: '1.0', nodes: [], edges: [] }),
  },
  ...MODEL_FAMILY_TEMPLATES,
  {
    key: 'daily_energy',
    label: '每日能耗预测（同源）',
    hint: '从能管选择同一类来源中的生产与能耗指标，将示例列「计划产量、工单数、能耗」及目标列换成实际取数标识 → 按完整日汇总 → 时序验证 → 发布模型。至少准备 35 个完整日；能耗须为期间用量，预测时提供每日计划数据。',
    build: () => dailyEnergyGraph(),
  },
  {
    key: 'daily_energy_joined',
    label: '每日能耗预测（生产与能耗分源）',
    hint: '分别从能管选择生产、能耗指标，将示例列及目标列换成实际取数标识（关联后的能耗列带「能耗_」前缀）→ 各自按日汇总 → 同一天精确对齐 → 时序训练评估。发布后按输入签名提供每日计划产量、工单数；可继续增删算子。',
    build: () => dailyEnergyGraph(true),
  },
  {
    key: 'short_term_load',
    label: '短期负荷预测（每半小时）',
    hint: '从能管选择负荷、计划产量、工单数与预报温度指标，将筛选列、汇总列、缺失检查列及目标列换成实际取数标识，历史关联列保留对应前缀。未来 6 小时，每半小时一个点（12 点），历史负荷按 6 小时、24 小时、7 天精确对齐。至少准备 42 天历史；负荷为平均功率 kW，发布后逐点提供计划和对应历史负荷。',
    build: shortTermLoadGraph,
  },
  {
    key: 'device_anomaly',
    label: '设备异常检测（正常工况）',
    hint: '从能管选择电流、频率、温度等正常工况指标，将示例筛选列换成实际取数标识，无需故障标签。按时间切分，学习多变量关系并校准阈值；发布后第三方输入实时值，检测接口返回是否异常。至少 100 行，建议覆盖代表性工况。',
    build: deviceAnomalyGraph,
  },
  ...ENERGY_RULE_TEMPLATES,
  {
    key: 'regression',
    label: '回归预测',
    hint: '从能管选择指标并设置实际目标列 → 填缺失 → 标准化 → 切分 → 线性回归 → 回归评估。预测一个连续量（能耗、产量）。',
    build: () =>
      chain(
        [
          ['s', 'bdm_source'],
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
    hint: '从能管选择指标并设置实际目标列 → 填缺失 → 切分 → 树回归 → 回归评估。关系不是直线时用它（低负荷段的能耗几乎是台阶）。⚠ 树不外推，训练区间之外一律给边界值。',
    build: () =>
      chain(
        [
          ['s', 'bdm_source'],
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
    hint: '从能管选择指标并设置实际类别目标列 → 填缺失 → 标准化 → 切分 → 逻辑回归 → 分类评估。判两档（合格 / 不合格）。',
    build: () =>
      chain(
        [
          ['s', 'bdm_source'],
          ['f', 'fill_missing'],
          ['z', 'standardize'],
          ['p', 'split_dataset'],
        ],
        'logistic_regression',
        'classification_metrics',
      ),
  },
]
