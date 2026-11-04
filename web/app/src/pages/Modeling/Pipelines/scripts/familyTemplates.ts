/** @fileoverview 四个模型族的开箱训练与探索模板，业务数据必须由使用者选择。 */
import type { ModelingGraph } from '@dt/contracts'
import type { PipelineTemplate } from './templateGraph'
import { bdmSourceConfig, chain, edge, node } from './templateGraph'

function supervised(model: string, evaluator: string): ModelingGraph {
  const graph = chain(
    [
      ['s', 'bdm_source'],
      ['f', 'fill_missing'],
      ['p', 'split_dataset'],
    ],
    model,
    evaluator,
  )
  return {
    ...graph,
    nodes: graph.nodes.map((item) => {
      if (item.id === 'p') return { ...item, config: { target_column: '' } }
      if (item.id === 'v' && evaluator === 'classification_metrics')
        return { ...item, config: { average: 'macro' } }
      return item
    }),
  }
}
function clustering(): ModelingGraph {
  return {
    format_version: '1.0',
    nodes: [
      node('s', 'bdm_source', 0, bdmSourceConfig()),
      node('d', 'drop_missing', 1),
      node('m', 'clustering_analysis', 2),
    ],
    edges: [
      edge('sd', 's', 'frame', 'd', 'frame'),
      edge('dm', 'd', 'frame', 'm', 'frame'),
    ],
  }
}
function anomaly(): ModelingGraph {
  return {
    format_version: '1.0',
    nodes: [
      node('s', 'bdm_source', 0, bdmSourceConfig()),
      node('d', 'drop_missing', 1),
      node('p', 'split_samples', 2),
      node('m', 'anomaly_model', 3),
    ],
    edges: [
      edge('sd', 's', 'frame', 'd', 'frame'),
      edge('dp', 'd', 'frame', 'p', 'frame'),
      edge('train', 'p', 'train', 'm', 'train'),
      edge('test', 'p', 'test', 'm', 'test'),
    ],
  }
}
export const MODEL_FAMILY_TEMPLATES: readonly PipelineTemplate[] = [
  {
    key: 'regression_model',
    label: '通用回归模型',
    hint: '从能管选择实际数值指标，并设置连续目标列 → 填缺失 → 按时序切分 → 在回归算法下拉中选择线性、近邻、树集成或品牌提升模型 → 查看回归评估。无需替换节点或重接线，具体算法参数沿用后端默认值并可调整。',
    build: () => supervised('regression_model', 'regression_metrics'),
  },
  {
    key: 'classification_model',
    label: '通用分类模型',
    hint: '从能管选择实际数值指标，并设置数值类别目标列 → 填缺失 → 按时序切分 → 在分类算法下拉中切换模型 → 查看混淆矩阵和宏平均评估。支持多分类；业务类别必须来自真实目标列，不使用虚构标签。',
    build: () => supervised('classification_model', 'classification_metrics'),
  },
  {
    key: 'clustering_analysis',
    label: '聚类分组（批量分析）',
    hint: '从能管选择参与分析的实际数值指标 → 明确剔除缺失行 → 在聚类算法下拉中选择分组方法 → 查看标签、簇数量与轮廓系数。无需目标列；这是整批探索分析，不产出可部署模型。',
    build: clustering,
  },
  {
    key: 'anomaly_model',
    label: '正常工况异常模型',
    hint: '从能管选择正常工况下的实际数值传感器指标 → 剔除缺失行 → 按时间切出正常训练段和独立测试段 → 切换异常检测算法。训练内部另留校准段，不默认填补无效传感器；无需故障标签，异常分数不是故障概率。',
    build: anomaly,
  },
]
