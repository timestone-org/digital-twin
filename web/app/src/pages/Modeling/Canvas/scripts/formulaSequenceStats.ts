/** @fileoverview 有序变化、累计、排名、描述统计、相关与分箱的计算口径。 */
import type { FormulaContext } from './formulaArgs'
import { textAt } from './formulaArgs'
import { tableExplanation } from './formulaTabularArgs'

function difference(context: FormulaContext) {
  const method = textAt(context.config, 'method')
  const expressions: Record<string, string> = {
    difference: 'y_i = x_i − x_(i−p)',
    ratio: 'y_i = x_i / x_(i−p)',
    pct_change: 'y_i = (x_i / x_(i−p) − 1) × 100',
  }
  return tableExplanation(context, {
    id: 'difference',
    title: '与向前几行的观测比较',
    expressions: [
      expressions[method] ?? 'y_i = difference / ratio / pct_change',
    ],
    parameters: [
      ['columns', '计算列'],
      ['method', '计算方式'],
      ['periods', '间隔行数 p'],
      ['suffix', '新增列后缀'],
      ...(method === 'difference'
        ? []
        : ([['on_zero', '前值为零时']] as const)),
    ],
    legend: [
      { symbol: 'p', text: '向前间隔的观测行数，不是分钟或固定采样时间' },
    ],
    notes: [
      '按观测行数计算；有时间索引时必须严格递增且唯一，不隐式补齐缺少的时刻。',
      '前 p 行或当前值、前值任一缺失时输出为空。增长率是百分数，输出 100 表示增长 100%。',
      '比值或增长率的前值为零时按配置留空或报错；普通差分只做减法。',
    ],
  })
}
function cumulativeStats(context: FormulaContext) {
  const method = textAt(context.config, 'method')
  const policy = textAt(context.config, 'missing_policy')
  const expressions: Record<string, string> = {
    sum: 'y_i = sum(V_i)',
    mean: 'y_i = sum(V_i) / count(V_i)',
    min: 'y_i = min(V_i)',
    max: 'y_i = max(V_i)',
  }
  return tableExplanation(context, {
    id: 'cumulative',
    title: '从首行到当前行累计',
    expressions: [expressions[method] ?? 'y_i = 所选累计统计(V_i)'],
    parameters: [
      ['columns', '累计列'],
      ['method', '统计方式'],
      ['missing_policy', '缺失策略'],
      ['suffix', '新增列后缀'],
    ],
    legend: [{ symbol: 'V_i', text: '从首行到第 i 行的有效值，不读取未来行' }],
    notes: [
      policy === 'skip'
        ? '缺失行结果仍为空，后续继续累计此前有效值；累计平均的分母仅统计有效值。'
        : policy === 'propagate'
          ? '遇到缺失后，该行及后续全部结果留空。'
          : '缺失行始终留空；后续继续累计或全部传播为空，由配置决定。',
      '按当前行序计算；有时间索引时要求严格递增且唯一。生成新列，保留原始观测。',
    ],
  })
}
function rankRows(context: FormulaContext) {
  const method = textAt(context.config, 'method')
  const rules: Record<string, string> = {
    average: '并列项取其占据首尾名次的平均。',
    min: '并列项取占据的最小名次，随后名次跳过占位。',
    dense: '并列项共享名次，后续名次连续。',
    ordinal: '相同值按原行序分配不同名次。',
  }
  return tableExplanation(context, {
    id: 'rank',
    title: '分组内排序与并列名次',
    expressions: ['r_i = rank_method(x_i | group_i)'],
    parameters: [
      ['column', '排名列'],
      ['group_columns', '分组列'],
      ['method', '并列方式'],
      ['is_ascending', '小值优先'],
      ['output_column', '新增排名列'],
    ],
    legend: [
      { symbol: 'r_i', text: '从 1 开始的名次；缺失值不参与排名且结果为空' },
    ],
    notes: [
      rules[method] ?? '并列处理支持平均、最小名次、连续名次和原行序不同名次。',
      context.config['is_ascending'] === true
        ? '按从小到大排名，小值排名在前。'
        : context.config['is_ascending'] === false
          ? '按从大到小排名，大值排名在前。'
          : '升降序使用运行时配置，未记录时不代入。',
      '未选分组列时对全部输入排名；空分组键归为同一组。使用整组数据计算排名，输出仍保持原行序。',
    ],
  })
}
function describeStats(context: FormulaContext) {
  const ddof = textAt(context.config, 'ddof')
  const divisor =
    ddof === 'sample' ? 'n − 1' : ddof === 'population' ? 'n' : 'n − δ'
  return tableExplanation(context, {
    id: 'describe',
    title: '每列的有效数、均值与离散度',
    expressions: [
      'mean = sum(x_i) / n',
      `std = sqrt(sum((x_i − mean)²) / (${divisor}))`,
      'Q(q) = x_floor(h)·(1−w) + x_ceil(h)·w',
    ],
    parameters: [
      ['columns', '统计列'],
      ['ddof', '标准差口径'],
    ],
    legend: [
      { symbol: 'n', text: '该列非空有效观测数' },
      { symbol: 'δ', text: '样本口径为 1，总体口径为 0' },
      { symbol: 'h / w', text: 'h = (n−1)q；w 为 h 的小数部分，x 按数值升序' },
    ],
    notes: [
      '逐列排除缺失，缺失数 = 总行数减有效数；每个原数值列输出一行统计结果。',
      '四分位数使用线性插值；标准差分母不大于零时留空，单个样本不伪造样本标准差 0。',
      '全列无有效观测时，有效数为 0，统计值保持为空；输出不再保留原时间索引。',
    ],
  })
}
function correlation(context: FormulaContext) {
  const method = textAt(context.config, 'method')
  return tableExplanation(context, {
    id: 'correlation',
    title: '每对列的相关系数及有效配对',
    expressions: [
      'r = S_ab / sqrt(S_aa·S_bb)',
      'S_ab = sum((a_i−mean_a)·(b_i−mean_b))',
      'S_aa = sum((a_i−mean_a)²)',
      'S_bb = sum((b_i−mean_b)²)',
    ],
    parameters: [
      ['columns', '分析列'],
      ['method', '相关方法'],
      ['min_pairs', '最少有效配对'],
    ],
    legend: [
      {
        symbol: 'a / b',
        text:
          method === 'spearman'
            ? '有效配对内分别计算的平均秩'
            : 'Pearson 使用有效配对值；Spearman 使用其平均秩',
      },
    ],
    notes: [
      '相关系数是中心化乘积和除以两侧离差平方和的几何平均，结果限制在 [−1, 1]；相关不代表因果关系。',
      '每对列独立排除任一侧缺失的行，输出真实有效配对数；Spearman 在剩余配对内取平均秩，再计算 Pearson。',
      '有效配对不足配置下限或任一侧为常量列时，相关系数留空。最多 32 列，输出含对角线的上三角列对。',
    ],
  })
}
function binning(context: FormulaContext) {
  const rightClosed = context.config['is_right_closed']
  const comparison =
    rightClosed === false
      ? 'b ≤ x'
      : rightClosed === true
        ? 'b < x'
        : 'b 与 x 的比较由闭区间配置决定'
  return tableExplanation(context, {
    id: 'bin',
    title: '固定边界如何决定箱号',
    expressions: [`bin(x) = count({b ∈ B : ${comparison}})`],
    parameters: [
      ['columns', '分箱列'],
      ['boundaries', '递增边界 B'],
      ['is_right_closed', '边界归入左侧'],
      ['suffix', '新增列后缀'],
    ],
    legend: [{ symbol: 'B', text: '用户显式给出的严格递增边界，不从样本估计' }],
    notes: [
      '箱号从 0 开始；两端自动覆盖所有更小或更大值，空值保持为空。',
      rightClosed === true
        ? '开启左侧归入：x 恰等于边界时进入左侧箱，使用严格 b < x 计数。'
        : rightClosed === false
          ? '关闭左侧归入：x 恰等于边界时进入右侧箱，使用 b ≤ x 计数。'
          : '边界等值归入左侧还是右侧，由配置决定。',
      '新增带后缀的数值箱号列，保留原始列。',
    ],
  })
}
export const SEQUENCE_STATS_FORMULAS = {
  difference: [difference],
  cumulative_stats: [cumulativeStats],
  rank_rows: [rankRows],
  describe_stats: [describeStats],
  correlation: [correlation],
  binning: [binning],
}
