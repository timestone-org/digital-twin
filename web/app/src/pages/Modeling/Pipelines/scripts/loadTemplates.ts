/** @fileoverview 半小时负荷预测：精确历史对齐、周期编码、时序训练与评估。 */
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
    position: { left: 80 + at[0] * 220, top: 100 + at[1] * 220 },
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

function historyNodes(): ModelingGraphNode[] {
  return [
    node('h', 'select_columns', '仅取历史负荷', [3, 1], { columns: ['负荷'] }),
    node('h6', 'time_shift', '6 小时前负荷 → 目标时刻', [4, 1], {
      offset_minutes: 360,
    }),
    node('hd', 'time_shift', '昨日同时刻 → 目标时刻', [5, 2], {
      offset_minutes: 1440,
    }),
    node('hw', 'time_shift', '上周同时刻 → 目标时刻', [6, 3], {
      offset_minutes: 10080,
    }),
    node('j6', 'ledger_join', '精确关联 6 小时前负荷', [5, 0], {
      how: 'left',
      tolerance_ms: 0,
      right_prefix: '六小时前_',
    }),
    node('jd', 'ledger_join', '精确关联昨日同时刻', [6, 0], {
      how: 'left',
      tolerance_ms: 0,
      right_prefix: '昨日_',
    }),
    node('jw', 'ledger_join', '精确关联上周同时刻', [7, 0], {
      how: 'left',
      tolerance_ms: 0,
      right_prefix: '上周_',
    }),
  ]
}

function trainingNodes(): ModelingGraphNode[] {
  return [
    node('d', 'drop_missing', '剔除缺失目标或历史输入的时段', [8, 0], {
      axis: 'row',
      how: 'any',
      subset: [
        '负荷',
        '六小时前_负荷',
        '昨日_负荷',
        '上周_负荷',
        '计划产量',
        '工单数',
        '预报温度',
      ],
    }),
    node('t', 'cyclic_time', '半小时时刻的日内 / 周内周期', [9, 0], {
      cycles: ['day', 'week'],
      timezone_offset_minutes: 480,
    }),
    node('z', 'standardize', '只用训练段拟合标准化', [10, 0], {}),
    node('p', 'split_dataset', '按时间留出最近 20%（至少 7 天）', [11, 0], {
      target_column: '负荷',
      method: 'time_order',
      test_ratio: 0.2,
      min_test_rows: 336,
    }),
    node('m', 'linear_regression', '未来 6 小时半小时负荷模型', [12, 0], {
      use_intercept: true,
      regularization: 'ridge',
      ridge_alpha: 1,
    }),
    node('v', 'regression_metrics', '检查 kW 误差后发布', [13, 0], {}),
  ]
}

export function shortTermLoadGraph(): ModelingGraph {
  return {
    format_version: '1.0',
    nodes: [
      node('s', 'ledger_source', '选择历史负荷与生产计划台账', [0, 0], {
        table_code: '',
        since: '-120d',
        row_source: 'collect',
      }),
      node('c', 'select_columns', '选择预测时已知的计划与气象字段', [1, 0], {
        columns: ['计划产量', '工单数', '预报温度', '负荷'],
      }),
      node('a', 'resample', '完整半小时：负荷取平均功率', [2, 0], {
        bucket: '30m',
        agg: 'avg',
        column_aggregations: { 计划产量: 'sum', 工单数: 'sum' },
        missing_policy: 'propagate',
        should_keep_complete_buckets: true,
      }),
      ...historyNodes(),
      ...trainingNodes(),
    ],
    edges: [
      connect('s', 'c'),
      connect('c', 'a'),
      connect('a', 'h'),
      connect('h', 'h6'),
      connect('h', 'hd'),
      connect('h', 'hw'),
      connect('a', 'j6', 'frame', 'left'),
      connect('h6', 'j6', 'frame', 'right'),
      connect('j6', 'jd', 'frame', 'left'),
      connect('hd', 'jd', 'frame', 'right'),
      connect('jd', 'jw', 'frame', 'left'),
      connect('hw', 'jw', 'frame', 'right'),
      connect('jw', 'd'),
      connect('d', 't'),
      connect('t', 'z'),
      connect('z', 'p'),
      connect('p', 'm', 'train', 'train'),
      connect('p', 'm', 'test', 'test'),
      connect('m', 'v', 'scored', 'scored'),
    ],
  }
}
