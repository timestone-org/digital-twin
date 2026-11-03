/** @fileoverview 新增表格算子的说明跟随冻结参数，准确表达边界与缺失口径。 */
import { expect, it } from 'vitest'
import { formulaText } from '@/pages/Modeling/Canvas/scripts/formula'
import { formulasOf } from '@/pages/Modeling/Canvas/scripts/formulaCatalog'

function spec(code: string, config: Record<string, unknown> = {}) {
  const result = formulasOf(code, { blocks: [], ports: [], config })[0]
  if (!result) throw new Error(`缺少算子说明：${code}`)
  return result
}
function notes(code: string, config: Record<string, unknown> = {}) {
  return spec(code, config).notes.join(' ')
}
it.each([
  'deduplicate',
  'sort_rows',
  'sample_rows',
  'group_aggregate',
  'key_join',
  'concat_rows',
  'text_transform',
  'replace_values',
  'numeric_transform',
  'column_math',
  'difference',
  'cumulative_stats',
  'rank_rows',
  'describe_stats',
  'correlation',
  'binning',
])('%s 无参数时有准确骨架与缺参说明，保持折叠', (code) => {
  const value = spec(code)
  expect(value.symbolic.length).toBeGreaterThan(0)
  expect(value.notes.length).toBeGreaterThan(0)
  expect(value.filled).toBeNull()
  expect(value.fallback).toContain('没有记下这个参数')
  expect(value.isOpen).toBe(false)
})
it('去重、排序、抽样说明真实行序与取整口径', () => {
  expect(notes('deduplicate', { keep: 'none' })).toContain('全部删除')
  expect(
    formulaText(
      spec('sort_rows', {
        columns: ['设备', '能耗'],
        direction: 'descending',
        nulls: 'first',
      }).filled ?? [],
    ),
  ).toContain('设备')
  expect(notes('sort_rows', { nulls: 'first' })).toContain('放在最前')
  expect(
    formulaText(
      spec('sample_rows', { size_mode: 'ratio', ratio: 0.25, method: 'stride' })
        .symbolic,
    ),
  ).toContain('ceil')
  expect(notes('sample_rows', { method: 'random' })).toContain('不放回')
  expect(notes('sample_rows', { method: 'stride' })).toContain('floor(i')
})
it('分组、业务键关联与合并不隐去空值和重复键限制', () => {
  expect(notes('group_aggregate', { agg: 'count' })).toContain('返回 0')
  expect(notes('group_aggregate', { agg: 'avg' })).toContain('非空个数')
  expect(notes('key_join', { how: 'inner' })).toContain('仅保留匹配成功')
  expect(notes('key_join', { how: 'left' })).toContain('右侧整行留空')
  expect(notes('key_join')).toContain('唯一')
  expect(notes('concat_rows', { columns_mode: 'union' })).toContain('缺列留空')
  expect(notes('concat_rows', { columns_mode: 'strict' })).toContain(
    '列名集合一致',
  )
})
it('文本固定替换与字符长度、数值定义域及偶数舍入口径准确', () => {
  expect(notes('text_transform', { method: 'replace' })).toContain('不解释正则')
  expect(notes('text_transform', { method: 'length' })).toContain('Unicode')
  expect(
    formulaText(
      spec('numeric_transform', { method: 'affine', factor: 2, offset: 3 })
        .symbolic,
    ),
  ).toContain('a*x + b')
  expect(
    formulaText(
      spec('numeric_transform', { method: 'affine', factor: 2, offset: 3 })
        .filled ?? [],
    ),
  ).toContain('2')
  expect(notes('numeric_transform', { method: 'round' })).toContain('偶数')
  expect(
    notes('numeric_transform', { method: 'log', on_invalid: 'null' }),
  ).toContain('x > 0')
  expect(notes('numeric_transform', { on_invalid: 'error' })).toContain(
    '整步报错',
  )
})
it('替换和列间运算明确零值、空值与右侧来源', () => {
  expect(notes('replace_values', { should_include_missing: false })).toContain(
    '空值保持为空',
  )
  expect(notes('replace_values', { should_include_missing: true })).toContain(
    '同时填充空值',
  )
  const math = spec('column_math', {
    left_column: '用量',
    right_mode: 'constant',
    constant: 0,
    method: 'divide',
    on_invalid: 'null',
  })
  expect(formulaText(math.filled ?? [])).toContain('0')
  expect(math.notes.join('')).toContain('除零')
  expect(notes('column_math', { right_mode: 'column' })).toContain('右侧数值列')
})
it('差分增长率、累计缺失与四种并列排名说明匹配实际计算', () => {
  expect(
    formulaText(
      spec('difference', { method: 'pct_change', periods: 3 }).symbolic,
    ),
  ).toContain('100')
  expect(
    formulaText(spec('difference', { method: 'ratio' }).symbolic),
  ).not.toContain('100')
  expect(notes('difference')).toContain('观测行数')
  expect(notes('cumulative_stats', { missing_policy: 'skip' })).toContain(
    '后续继续',
  )
  expect(notes('cumulative_stats', { missing_policy: 'propagate' })).toContain(
    '后续全部',
  )
  expect(notes('rank_rows', { method: 'average' })).toContain('首尾名次的平均')
  expect(notes('rank_rows', { method: 'dense' })).toContain('连续')
  expect(notes('rank_rows', { method: 'ordinal' })).toContain('原行序')
  expect(notes('rank_rows', { method: 'min' })).toContain('最小名次')
})
it('描述统计区分样本总体，Spearman在有效配对内取平均秩', () => {
  expect(
    formulaText(spec('describe_stats', { ddof: 'sample' }).symbolic),
  ).toContain('n - 1')
  expect(
    formulaText(spec('describe_stats', { ddof: 'population' }).symbolic),
  ).not.toContain('n - 1')
  expect(notes('describe_stats')).toContain('线性插值')
  expect(notes('correlation', { method: 'spearman', min_pairs: 5 })).toContain(
    '平均秩',
  )
  expect(notes('correlation')).toContain('常量列')
})
it('分箱左右闭区间使用真实严格不等号，边界参数和输出后缀可读', () => {
  expect(
    formulaText(spec('binning', { is_right_closed: true }).symbolic),
  ).toContain('b < x')
  expect(
    formulaText(spec('binning', { is_right_closed: false }).symbolic),
  ).toContain('b <= x')
  expect(
    formulaText(
      spec('binning', { boundaries: [0, 10], suffix: '_grade' }).filled ?? [],
    ),
  ).toContain('_grade')
  expect(notes('binning')).toContain('从 0 开始')
})
