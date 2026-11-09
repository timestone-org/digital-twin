/** @fileoverview API 来源的参数校验与引用保护。 */
import { describe, expect, it } from 'vitest'
import {
  MAX_API_COLUMNS,
  columnsFromSample,
  dateToken,
  jsonObject,
  metricRefAttrs,
  metricsForSource,
  queryObject,
  sourceIsUsed,
  validateSource,
  validPointer,
  type ApiSource,
} from '@/pages/Reports/Editor/scripts/apiSourceForm'

const source: ApiSource = {
  code: 'energy',
  name: '能耗',
  connection: 'ems',
  path: '/monthly',
  columns: [{ key: 'value', name: '用电量', pointer: '/value' }],
  offset: 0,
}
describe('API 来源表单', () => {
  it('保留报告期占位符并拒绝非法 JSON', () => {
    expect(queryObject('{"start":"{{start}}"}')).toEqual({ start: '{{start}}' })
    expect(jsonObject('{"value":10}', '请求体')).toEqual({ value: 10 })
    expect(() => jsonObject('{', '请求体')).toThrow('有效的 JSON')
    expect(() => jsonObject('[]', '请求体')).toThrow('JSON 对象')
    expect(() => queryObject('{"count":10}')).toThrow('字符串')
  })
  it('只允许有效的相对路径和字段映射', () => {
    expect(() => validateSource(source)).not.toThrow()
    for (const path of [
      'https://example.com',
      '//example.com',
      '/a/../b',
      '/path?token=x',
      '/%zz',
    ])
      expect(() => validateSource({ ...source, path })).toThrow()
    expect(() => validateSource({ ...source, code: '1bad' })).toThrow(
      '来源编码',
    )
    expect(() => validateSource({ ...source, code: 'a'.repeat(61) })).toThrow(
      '最多 60 字符',
    )
    expect(() => validateSource({ ...source, name: '' })).toThrow('来源名称')
    expect(() => validateSource({ ...source, offset: 121 })).toThrow(
      '报告期偏移',
    )
    expect(() => validateSource({ ...source, rows_pointer: 'data' })).toThrow(
      'JSON Pointer',
    )
    expect(() => validateSource({ ...source, columns: [] })).toThrow('映射字段')
    expect(() =>
      validateSource({
        ...source,
        columns: [...source.columns, ...source.columns],
      }),
    ).toThrow('不能重复')
    expect(() =>
      validateSource({
        ...source,
        columns: [{ key: 'value', name: '值', pointer: '/a~3' }],
      }),
    ).toThrow('JSON Pointer')
  })
  it('JSON Pointer 支持根值和合法转义', () => {
    expect(validPointer('')).toBe(true)
    expect(validPointer('/a~1b/~0key')).toBe(true)
    expect(validPointer('/a~')).toBe(false)
  })
  it('指标与多序列正文引用都会阻止删除数据源', () => {
    expect(
      sourceIsUsed(
        { type: 'doc' },
        [{ name: '值', table: 'api:energy' }],
        'energy',
      ),
    ).toBe(true)
    expect(
      sourceIsUsed(
        {
          type: 'doc',
          content: [
            {
              type: 'dsChart',
              attrs: { series: [{ table: 'api:energy', key: 'value' }] },
            },
          ],
        },
        [],
        'energy',
      ),
    ).toBe(true)
    expect(sourceIsUsed({ type: 'doc' }, [], 'energy')).toBe(false)
  })
})

describe('能管列表接口配置', () => {
  it('日期变量按偏移与格式拼出后端语法', () => {
    expect(dateToken('year', 0, '')).toBe('{{year}}')
    expect(dateToken('year', -1, '')).toBe('{{year-1}}')
    expect(dateToken('month', -1, 'YYYY-MM')).toBe('{{month-1:YYYY-MM}}')
    expect(dateToken('day', 2, 'YYYYMMDD')).toBe('{{day+2:YYYYMMDD}}')
  })
  it('样例列表逐项生成字段并按值推断类型', () => {
    const columns = columnsFromSample(
      '["1.2", "2026年11月", "增长", 5, true]',
      [],
    )
    expect(columns.map((item) => item.pointer)).toEqual([
      '/0',
      '/1',
      '/2',
      '/3',
      '/4',
    ])
    expect(columns.map((item) => item.data_type)).toEqual([
      'number',
      'text',
      'text',
      'number',
      'boolean',
    ])
    expect(columns[0]).toMatchObject({ key: 'item_1', name: '第1项' })
  })
  it('重新解析样例保留同位置字段的编码与名称', () => {
    const [first] = columnsFromSample('["1.2"]', [
      { key: 'power', name: '用电量', pointer: '/0' },
    ])
    expect(first).toMatchObject({ key: 'power', name: '用电量' })
  })
  it('样例最多 300 项，超出给出上限', () => {
    const sample = (count: number): string =>
      JSON.stringify(Array.from({ length: count }, (_, index) => index))
    expect(MAX_API_COLUMNS).toBe(300)
    expect(columnsFromSample(sample(300), [])).toHaveLength(300)
    expect(() => columnsFromSample(sample(301), [])).toThrow('1～300 项')
  })
  it.each(['{', '{"a":1}', '[]', '[{"a":1}]'])('拒绝样例 %s', (text) => {
    expect(() => columnsFromSample(text, [])).toThrow()
  })
  it('一键指标跳过已映射字段与重名', () => {
    const list: ApiSource = {
      ...source,
      columns: [
        { key: 'a', name: '第1项', pointer: '/0' },
        { key: 'b', name: '第2项', pointer: '/1' },
        { key: 'c', name: '第3项', pointer: '/2' },
      ],
    }
    const found = metricsForSource(list, [
      { name: '已有', table: 'api:energy', key: 'a' },
      { name: '能耗_第2项', table: 't', key: 'x' },
    ])
    expect(found).toEqual([
      { name: '能耗_第3项', table: 'api:energy', key: 'c', mode: 'latest' },
    ])
  })
  it('列表来源的指标按原值插入，其余保留两位小数', () => {
    const list: ApiSource = { ...source, row_shape: 'single' }
    const metrics = [
      { name: '列表值', table: 'api:energy', key: 'value' },
      { name: '台账值', table: 'ledger', key: 'value' },
    ]
    expect(metricRefAttrs('{列表值}', metrics, [list]).precision).toBeNull()
    expect(metricRefAttrs('{台账值}', metrics, [list]).precision).toBe(2)
    expect(metricRefAttrs('{列表值}', metrics, [source]).precision).toBe(2)
  })
})
