/** @fileoverview 指标取数方式的回读与列表检索。 */
import { expect, it } from 'vitest'
import {
  existingMode,
  filterMetrics,
  metricFields,
} from '@/pages/Reports/Editor/scripts/metricModes'

it('已存指标折回表单取数方式', () => {
  expect(existingMode({ name: 'a', mode: 'latest' })).toBe('latest')
  expect(existingMode({ name: 'a', mode: 'expr' })).toBe('expr')
  expect(existingMode({ name: 'a', mode: 'at_bucket' })).toBe('at_bucket')
  expect(existingMode({ name: 'a', mode: 'window_agg', agg: 'avg' })).toBe(
    'window_agg',
  )
  expect(existingMode({ name: 'a' })).toBe('window_agg')
  expect(existingMode({ name: 'a', mode: 'window_agg', agg: 'sum' })).toBe(
    'sum',
  )
})

it('检索忽略大小写与首尾空白，空词返回全部的副本', () => {
  const metrics = [
    { name: '本期电量', key: 'E_total' },
    { name: '上期电量', key: 'e_last' },
    { name: '水耗' },
  ]
  const describe = (metric: { name: string }) =>
    metric.name === '水耗' ? '能管 · 水' : ''
  const all = filterMetrics(metrics, '  ', describe)
  expect(all).toEqual(metrics)
  expect(all).not.toBe(metrics)
  expect(filterMetrics(metrics, ' e_TOTAL ', describe)).toEqual([metrics[0]])
  expect(filterMetrics(metrics, '电量', describe)).toHaveLength(2)
  expect(filterMetrics(metrics, '能管', describe)).toEqual([metrics[2]])
})

it('指标转表单初值，空白表单回到期内均值本期', () => {
  expect(metricFields(null)).toEqual({
    name: '',
    key: '',
    expression: '',
    mode: 'window_agg',
    offset: '0',
    unit: '',
  })
  expect(
    metricFields({
      name: '上期电',
      key: 'e',
      mode: 'window_agg',
      agg: 'sum',
      offset: -1,
      unit: 'kWh',
      expr: null,
    }),
  ).toEqual({
    name: '上期电',
    key: 'e',
    expression: '',
    mode: 'sum',
    offset: '-1',
    unit: 'kWh',
  })
})
