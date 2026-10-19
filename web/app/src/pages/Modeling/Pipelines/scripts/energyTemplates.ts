/** @fileoverview 每日能耗训练模板；生产与能耗可同表，也可分别汇总后按日对齐。 */
import type {
  ModelingGraph,
  ModelingGraphEdge,
  ModelingGraphNode,
} from '@dt/contracts'

function node(
  id: string,
  operator: string,
  alias: string,
  at: readonly [number, number],
  config: Record<string, unknown>,
): ModelingGraphNode {
  return {
    id,
    operator,
    alias,
    config,
    position: { left: 80 + at[0] * 220, top: 100 + at[1] * 240 },
  }
}

function connect(
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

function sourceBranch(
  suffix: string,
  columns: string[],
  row: number,
): ModelingGraphNode[] {
  return [
    node(
      `s${suffix}`,
      'ledger_source',
      suffix ? '历史能耗：选择台账' : '历史生产：选择台账',
      [0, row],
      { table_code: '', since: '-180d', row_source: 'collect' },
    ),
    node(
      `c${suffix}`,
      'select_columns',
      suffix ? '选择区间能耗列' : '选择计划产量、工单等列',
      [1, row],
      { columns },
    ),
    node(`a${suffix}`, 'resample', '汇总完整日：按列设置口径', [2, row], {
      bucket: '1d',
      agg: 'sum',
      missing_policy: 'propagate',
      should_keep_complete_buckets: true,
    }),
  ]
}

function trainingNodes(target: string, start: number): ModelingGraphNode[] {
  return [
    node('d', 'drop_missing', '剔除缺失实际能耗的日期', [start, 0], {
      axis: 'row',
      subset: [target],
    }),
    node('f', 'fill_missing', '仅填充特征缺失', [start + 1, 0], {}),
    node('z', 'standardize', '仅按训练段标准化特征', [start + 2, 0], {}),
    node('p', 'split_dataset', '按时间留出最近 20% 验证', [start + 3, 0], {
      target_column: target,
      method: 'time_order',
      test_ratio: 0.2,
      min_test_rows: 7,
    }),
    node(
      'm',
      'linear_regression',
      '每日能耗模型（含基础能耗）',
      [start + 4, 0],
      { use_intercept: true, regularization: 'none' },
    ),
    node('v', 'regression_metrics', '查看误差后发布模型', [start + 5, 0], {}),
  ]
}

export function dailyEnergyGraph(isJoined = false): ModelingGraph {
  const target = isJoined ? '能耗_能耗' : '能耗'
  const columns = isJoined
    ? ['计划产量', '工单数']
    : ['计划产量', '工单数', '能耗']
  const nodes = sourceBranch('', columns, 0)
  const edges = [connect('s', 'c'), connect('c', 'a')]
  if (isJoined) {
    nodes.push(
      ...sourceBranch('e', ['能耗'], 1),
      node('j', 'ledger_join', '只关联同一天的生产与能耗', [3, 0], {
        how: 'inner',
        tolerance_ms: 0,
        right_prefix: '能耗_',
      }),
    )
    edges.push(
      connect('se', 'ce'),
      connect('ce', 'ae'),
      connect('a', 'j', 'frame', 'left'),
      connect('ae', 'j', 'frame', 'right'),
    )
  }
  return {
    format_version: '1.0',
    nodes: [...nodes, ...trainingNodes(target, isJoined ? 4 : 3)],
    edges: [
      ...edges,
      connect(isJoined ? 'j' : 'a', 'd'),
      connect('d', 'f'),
      connect('f', 'z'),
      connect('z', 'p'),
      connect('p', 'm', 'train', 'train'),
      connect('p', 'm', 'test', 'test'),
      connect('m', 'v', 'scored', 'scored'),
    ],
  }
}
