/** @fileoverview 正常工况异常检测模板，不需要监督目标或故障标签。 */
import type {
  ModelingGraph,
  ModelingGraphEdge,
  ModelingGraphNode,
} from '@dt/contracts'

function node(
  id: string,
  operator: string,
  alias: string,
  at: number,
  config: Record<string, unknown>,
): ModelingGraphNode {
  return {
    id,
    operator,
    alias,
    config,
    position: { left: 80 + at * 240, top: 180 },
  }
}

function edge(
  from: string,
  to: string,
  fromPort = 'frame',
  toPort = 'frame',
): ModelingGraphEdge {
  return {
    id: `${from}_${fromPort}_${to}_${toPort}`,
    from_node: from,
    from_port: fromPort,
    to_node: to,
    to_port: toPort,
  }
}

export function deviceAnomalyGraph(): ModelingGraph {
  return {
    format_version: '1.0',
    nodes: [
      node('s', 'ledger_source', '选择正常工况历史台账', 0, {
        table_code: '',
        row_source: 'collect',
        since: '-30d',
      }),
      node('c', 'select_columns', '选择设备数值指标', 1, {
        columns: ['电流', '频率', '温度'],
      }),
      node('d', 'drop_missing', '剔除缺失样本，保留真实零值', 2, {
        axis: 'row',
        how: 'any',
      }),
      node('p', 'split_samples', '无目标列：按时间留出测试段', 3, {
        method: 'time_order',
        test_ratio: 0.2,
        min_test_rows: 20,
      }),
      node('m', 'anomaly_distance', '学习正常工况并校准异常阈值', 4, {
        quantile: 0.99,
        shrinkage: 0.05,
        scale_floor: 0.01,
      }),
    ],
    edges: [
      edge('s', 'c'),
      edge('c', 'd'),
      edge('d', 'p'),
      edge('p', 'm', 'train', 'train'),
      edge('p', 'm', 'test', 'test'),
    ],
  }
}
