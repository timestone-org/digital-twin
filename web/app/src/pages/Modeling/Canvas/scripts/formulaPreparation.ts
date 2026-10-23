/** @fileoverview 选列、历史对齐、周期编码与异常判定的公式说明。 */
import { frac, nameOf, numOf, opOf, run, varOf } from './formula'
import type { FormulaNode } from './formula'
import type { FormulaContext, FormulaSpec } from './formulaArgs'
import {
  NO_CONFIG,
  hyperNumber,
  modelAt,
  numberAt,
  textsAt,
} from './formulaArgs'

function selectColumns(context: FormulaContext): FormulaSpec {
  const columns = textsAt(context.config, 'columns')
  return {
    id: 'columns',
    title: '按哪些列及顺序组成数据',
    symbolic: [run(varOf('X_out'), opOf('='), varOf('X[:, C]'))],
    filled:
      columns.length === 0
        ? null
        : [run(varOf('C'), opOf('='), nameOf(columns.join('、')))],
    fallback: columns.length === 0 ? NO_CONFIG : null,
    isOpen: false,
    legend: [{ symbol: 'C', text: '配置中有序且不重复的列清单' }],
    notes: ['仅选择列，不改数值、行序和时间索引；监督训练须保留目标列。'],
  }
}

function timeShift(context: FormulaContext): FormulaSpec {
  const offset = numberAt(context.config, 'offset_minutes')
  return {
    id: 'shift',
    title: '历史观测对齐到哪个目标时刻',
    symbolic: [
      run(varOf('t_target'), opOf('='), varOf('t_history + Δ · 60000')),
    ],
    filled:
      offset === null
        ? null
        : [run(varOf('Δ'), opOf('='), numOf(offset), nameOf('分钟'))],
    fallback: offset === null ? NO_CONFIG : null,
    isOpen: false,
    legend: [
      { symbol: 't', text: 'UTC 毫秒时间索引' },
      { symbol: 'Δ', text: '历史观测向未来平移的分钟数' },
    ],
    notes: ['数值不变；发布后的调用方须提供对应的历史值，模型不会自行取历史。'],
  }
}

function cyclicTime(context: FormulaContext): FormulaSpec {
  const offset = numberAt(context.config, 'timezone_offset_minutes')
  const cycles = textsAt(context.config, 'cycles')
  return {
    id: 'cycle',
    title: '时刻如何编码为连续周期特征',
    symbolic: [
      run(varOf('θ'), opOf('='), varOf('2π · ((m + δ) mod P) / P')),
      run(varOf('ts_sin'), opOf('='), varOf('sin(θ)')),
      run(varOf('ts_cos'), opOf('='), varOf('cos(θ)')),
    ],
    filled:
      offset === null
        ? null
        : [run(varOf('m'), opOf('='), varOf('t / 60000 +'), numOf(offset))],
    fallback: offset === null ? NO_CONFIG : null,
    isOpen: false,
    legend: [
      { symbol: 'm', text: 'Unix 纪元起的分钟数，加业务时区偏移' },
      { symbol: 'P', text: '日周期为 1440 分钟，周周期为 10080 分钟' },
      { symbol: 'δ', text: '日周期为 0；周周期加 4320 分钟，使周一起算' },
    ],
    notes: [
      `生成周期：${cycles.length === 0 ? '由配置决定' : cycles.join('、')}。`,
      '预测必须提供目标时刻，沿用训练时保存的时区偏移。',
    ],
  }
}

function anomalyDistance(context: FormulaContext): FormulaSpec {
  const quantile =
    hyperNumber(context.ports, 'quantile') ??
    numberAt(context.config, 'quantile')
  const threshold = numberAt(
    modelAt(context.ports)?.fitted ?? {},
    'distance_threshold',
  )
  const filled: FormulaNode[] = []
  if (quantile !== null)
    filled.push(run(varOf('q'), opOf('='), numOf(quantile)))
  if (threshold !== null) {
    filled.push(run(varOf('τ'), opOf('='), numOf(threshold)))
  } else if (quantile !== null) {
    filled.push(run(varOf('τ'), opOf('='), varOf('max(1, Q_higher(q, D_cal))')))
  }
  return {
    id: 'distance',
    title: '与正常工况的距离及异常判定',
    symbolic: [
      run(varOf('z_j'), opOf('='), varOf('(x_j − μ_j) / σ_j')),
      run(varOf('score'), opOf('=')),
      frac([run(varOf('max(0, zᵀ Σ⁻¹ z)'))], [run(varOf('τ'))]),
      run(varOf('is_anomaly'), opOf('⟺'), varOf('score > 1')),
    ],
    filled: filled.length === 0 ? null : filled,
    fallback: filled.length === 0 ? NO_CONFIG : null,
    isOpen: false,
    legend: [
      { symbol: 'μ / σ', text: '正常工况训练得到的中心与数值尺度' },
      { symbol: 'Σ⁻¹', text: '标准化后经收缩处理的协方差矩阵的逆' },
      { symbol: 'D_cal', text: '训练段末尾 25% 校准样本的平方距离' },
      { symbol: 'τ', text: '校准分位阈值，至少为 1' },
    ],
    notes: [
      '训练段前 75% 拟合，后 25% 校准；测试段不参与。',
      '异常分数不是故障概率；等于阈值时不判异常。',
    ],
  }
}

export const PREPARATION_FORMULAS = {
  select_columns: [selectColumns],
  time_shift: [timeShift],
  cyclic_time: [cyclicTime],
  anomaly_distance: [anomalyDistance],
} as const
