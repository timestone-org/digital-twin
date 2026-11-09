/** @fileoverview 数据内容表单与节点属性互转：后端 DataNodeSpec 的口径与校验顺序。 */
import { expect, it } from 'vitest'
import {
  formError,
  formFromNode,
  nodeFromForm,
} from '@/pages/Reports/Editor/scripts/nodeForm'

function ids(): () => string {
  let count = 0
  return () => {
    count += 1
    return `row-${count}`
  }
}

it('空白表单缺省为折线图，未选来源时给出第一条原因', () => {
  const form = formFromNode(null, ids())
  expect(form).toMatchObject({ kind: 'line', xAxis: 'time', limit: '100' })
  expect(formError(form)).toBe('请至少添加一个数据序列并选择字段')
})

it('校验条数、小数位与分类横轴的组合', () => {
  const base = formFromNode(
    { type: 'dsChart', attrs: { series: [{ table: 'a', key: 'v' }] } },
    ids(),
  )
  const first = base.series[0]
  if (!first) throw new Error('缺少序列')
  expect(formError(base)).toBe('')
  expect(formError({ ...base, limit: '0' })).toContain('1–1000')
  expect(formError({ ...base, kind: 'pie' })).toContain('饼图')
  expect(
    formError({
      ...base,
      xAxis: 'category',
      categoryKey: 'shop',
      series: [...base.series, { ...first, id: 'x', table: 'b' }],
    }),
  ).toContain('同一个数据来源')
  const table = formFromNode({ type: 'dsTable', attrs: {} }, ids())
  expect(formError(table)).toContain('要显示的列')
  expect(
    formError({ ...table, source: 'a', keys: ['v'], precision: '13' }),
  ).toContain('0–12')
  const inline = formFromNode({ type: 'condText', attrs: {} }, ids())
  expect(formError(inline)).toContain('表达式')
})

it('API 来源不写窗口与期偏移，台账表格保留报告期', () => {
  const api = formFromNode(
    {
      type: 'dsTable',
      attrs: { table: 'api:e', keys: ['p'], offset: -1, window: '12mo' },
    },
    ids(),
  )
  expect(nodeFromForm(api).attrs).toMatchObject({
    offset: 0,
    window: null,
    anchor: 'period',
  })
  const ledger = { ...api, source: 'energy' }
  expect(nodeFromForm(ledger).attrs).toMatchObject({
    offset: -1,
    window: '12mo',
  })
})

it('图表的分类字段只在按分类时写入，序列名去空白', () => {
  const form = formFromNode(
    {
      type: 'dsChart',
      attrs: {
        kind: 'pie',
        x_axis: 'field',
        category_key: 'shop',
        series: [{ table: 'api:e', key: 'p', name: ' 用电 ', offset: -1 }],
      },
    },
    ids(),
  )
  expect(nodeFromForm(form).attrs).toMatchObject({
    kind: 'pie',
    x_axis: 'field',
    category_key: '',
    table: 'api:e',
    series: [{ table: 'api:e', key: 'p', name: '用电', offset: 0 }],
  })
})

it('数字节点只写本表单管的属性，单位只给指标数字', () => {
  const previous = { type: 'condText', attrs: { expr: '', extra: 1 } }
  const form = {
    ...formFromNode(previous, ids()),
    expression: '{a}',
    unit: 'kWh',
  }
  expect(nodeFromForm(form, previous)).toEqual({
    type: 'condText',
    attrs: { expr: '{a}', extra: 1, precision: 2, unit: '' },
  })
})
