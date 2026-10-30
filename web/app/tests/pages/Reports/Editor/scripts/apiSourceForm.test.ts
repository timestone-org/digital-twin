/** @fileoverview API 来源的参数校验与引用保护。 */
import { describe, expect, it } from 'vitest'
import {
  jsonObject,
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
