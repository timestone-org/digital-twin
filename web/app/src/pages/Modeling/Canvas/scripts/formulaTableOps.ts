/** @fileoverview 去重、排序、抽样、分组与表关联的实际处理口径。 */
import type { FormulaContext } from './formulaArgs'
import { textAt } from './formulaArgs'
import { tableExplanation } from './formulaTabularArgs'

function deduplicate(context: FormulaContext) {
  const keep = textAt(context.config, 'keep')
  const rule: Record<string, string> = {
    first: '每组重复项保留第一行。',
    last: '每组重复项保留最后一行。',
    none: '有重复的组全部删除，只保留出现一次的行。',
  }
  return tableExplanation(context, {
    id: 'deduplicate',
    title: '哪些重复行会被保留',
    expressions: ['K_i = (x_i,c : c ∈ C)', 'R_out = 按 keep 选出的原始行'],
    parameters: [
      ['columns', '判重列'],
      ['keep', '保留策略'],
    ],
    legend: [
      { symbol: 'C', text: '判重列；留空使用全部输入列' },
      { symbol: 'K_i', text: '第 i 行在判重列上的值元组' },
    ],
    notes: [
      rule[keep] ?? '保留第一行、最后一行或删除整组重复项，由配置决定。',
      '空值与空值视为相同；输出保留原行序及对应时间索引。',
    ],
  })
}
function sortRows(context: FormulaContext) {
  const nulls = textAt(context.config, 'nulls')
  return tableExplanation(context, {
    id: 'sort',
    title: '多列排序的优先级与空值位置',
    expressions: ['R_out = stable_sort(R, [c_1, c_2, …])'],
    parameters: [
      ['columns', '排序优先级'],
      ['direction', '排序方向'],
      ['nulls', '空值位置'],
    ],
    legend: [
      { symbol: 'c_1', text: '优先级最高的列，后续列用于前面列同值时排序' },
    ],
    notes: [
      '按配置列序进行稳定排序；未选择列时按全部列排序，同值保持原行序。',
      nulls === 'first'
        ? '每个排序键的空值放在最前。'
        : nulls === 'last'
          ? '每个排序键的空值放在最后。'
          : '空值位置由配置决定，不随升降序反转。',
      '升降序统一作用于所有排序列；时间索引随行移动，并非自动按时间排序。',
    ],
  })
}
function sampleRows(context: FormulaContext) {
  const mode = textAt(context.config, 'size_mode')
  const method = textAt(context.config, 'method')
  const rules: Record<string, string> = {
    random: '使用固定随机种子不放回抽样，再按原行号排序输出。',
    head: '保留原表前 n 行。',
    stride: '从 i = 0 到 n − 1，选择行号 floor(i × N / n)，不包含重复抽取。',
  }
  return tableExplanation(context, {
    id: 'sample',
    title: '实际抽取行数与抽样位置',
    expressions: [
      mode === 'count' ? 'n = min(count, N)' : 'n = min(ceil(N × ratio), N)',
    ],
    parameters: [
      ['method', '抽样方式'],
      ['size_mode', '数量口径'],
      [mode === 'count' ? 'count' : 'ratio', '请求数量'],
      ...(method === 'random' ? ([['random_state', '随机种子']] as const) : []),
    ],
    legend: [
      { symbol: 'N', text: '输入行数' },
      { symbol: 'n', text: '实际输出行数' },
    ],
    notes: [
      rules[method] ?? '支持随机、前若干行与等距抽样；方式以配置为准。',
      '比例口径向上取整，非空输入至少保留一行；固定行数超过输入时保留全部。',
      '输出保持原输入行序，不自动重新排列时间。',
    ],
  })
}
function groupAggregate(context: FormulaContext) {
  const agg = textAt(context.config, 'agg')
  const expressions: Record<string, string> = {
    avg: 'y_g,c = sum(V_g,c) / count(V_g,c)',
    sum: 'y_g,c = sum(V_g,c)',
    count: 'y_g,c = count(V_g,c)',
    min: 'y_g,c = min(V_g,c)',
    max: 'y_g,c = max(V_g,c)',
    first: 'y_g,c = first(V_g,c)',
    last: 'y_g,c = last(V_g,c)',
  }
  return tableExplanation(context, {
    id: 'aggregate',
    title: '按组汇总哪些有效观测',
    expressions: [expressions[agg] ?? 'y_g,c = aggregate(V_g,c)'],
    parameters: [
      ['group_columns', '分组列'],
      ['columns', '度量列'],
      ['agg', '汇总方式'],
      ['max_groups', '分组上限'],
    ],
    legend: [{ symbol: 'V_g,c', text: '组 g 内列 c 按原行序排列的非空值' }],
    notes: [
      '空分组键会保留；不选分组列时汇总成一行，分组列不能同时作为度量列。',
      '计数是非空个数，不去重；整组全空时计数返回 0，其余统计保持为空。',
      'first / last 取第一个或最后一个非空值；超过分组上限报错，不截断。',
      '输出保留分组列，度量列名追加汇总方法后缀，时间索引不再保留。',
    ],
  })
}
function keyJoin(context: FormulaContext) {
  const how = textAt(context.config, 'how')
  return tableExplanation(context, {
    id: 'key-match',
    title: '业务键如何匹配左右表',
    expressions: ['match(i) = 唯一满足 L_i,k = R_j,k 的右表行'],
    parameters: [
      ['left_key', '左表键'],
      ['right_key', '右表键'],
      ['how', '保留行'],
      ['right_prefix', '右表列前缀'],
    ],
    legend: [{ symbol: 'L / R', text: '左表和右表' }],
    notes: [
      '左右关联键类型必须相同；右表非空键必须唯一，重复时明确报错，不做多对多膨胀。',
      '空键不匹配，包括左右两边都为空的情况。',
      how === 'inner'
        ? '仅保留匹配成功的左表行。'
        : how === 'left'
          ? '保留全部左表行；匹配失败时右侧整行留空，不补零。'
          : '保留全部左行或仅匹配成功行，由配置决定。',
      '右表全部列加前缀；保留左表的行序及对应时刻。',
    ],
  })
}
function concatRows(context: FormulaContext) {
  const mode = textAt(context.config, 'columns_mode')
  return tableExplanation(context, {
    id: 'concat',
    title: '两路数据如何纵向拼接',
    expressions: ['R_out = project(L, C) 后接 project(R, C)'],
    parameters: [['columns_mode', '列匹配口径']],
    legend: [{ symbol: 'C', text: '左表列序在前，右表新增列随后' }],
    notes: [
      mode === 'union'
        ? '使用两表列的并集，缺列留空。'
        : mode === 'strict'
          ? '严格模式要求两表列名集合一致，列序可以不同。'
          : '严格模式检查列集合，并集模式保留两侧全部列。',
      '同名列的类型、角色和单位必须一致；不按列的位置直接拼接。',
      '两表必须都有时间索引或都没有，索引名称一致；左表行在前、右表行在后，不自动排序或去重。',
    ],
  })
}
export const TABLE_FORMULAS = {
  deduplicate: [deduplicate],
  sort_rows: [sortRows],
  sample_rows: [sampleRows],
  group_aggregate: [groupAggregate],
  key_join: [keyJoin],
  concat_rows: [concatRows],
}
