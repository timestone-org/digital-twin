/** @fileoverview HTTP JSON 样例到点位映射的路径、类型、上限与错误契约。 */
import { describe, expect, it } from 'vitest'
import {
  parseHttpSample,
  validateHttpPointer,
} from '@/pages/Collect/Opcua/scripts/httpPointMapping'

describe('HTTP JSON 映射', () => {
  it('同一响应映射多个叶子，保留数组下标和转义键名', () => {
    const result = parseHttpSample(
      '{"data":{"temp":21.5,"count":3,"on":true,"name":"车间","items":[{"a/b~c":9}],"empty":null}}',
    )
    expect(result.error).toBeNull()
    expect(
      result.rows.map((row) => [row.address, row.fieldType, row.preview]),
    ).toEqual([
      ['/data/temp', 'float', '21.5'],
      ['/data/count', 'int', '3'],
      ['/data/on', 'bool', 'true'],
      ['/data/name', 'string', '车间'],
      ['/data/items/0/a~1b~0c', 'int', '9'],
    ])
    expect(result.skippedNulls).toBe(1)
  })
  it('根标量映射为非空 $ 地址', () => {
    expect(parseHttpSample('false').rows).toMatchObject([
      { address: '$', fieldType: 'bool', preview: 'false' },
    ])
  })
  it('大整数建议字符串，不把舍入后的值显示成精确读数', () => {
    const result = parseHttpSample(
      '{"large":9007199254740993,"exact":"9007199254740993"}',
    )
    expect(result.unsafeIntegers).toBe(1)
    expect(result.rows).toMatchObject([
      {
        address: '/large',
        fieldType: 'string',
        preview: '超出安全整数范围，无法精确预览',
      },
      { address: '/exact', fieldType: 'string', preview: '9007199254740993' },
    ])
  })
  it('建议编码可用且同名叶子不冲突', () => {
    const result = parseHttpSample('{"a":{"value":1},"b":{"value":2},"温度":3}')
    expect(result.rows.map((row) => row.code)).toEqual([
      'a_value',
      'b_value',
      'point_3',
    ])
  })
  it('无效 JSON、过深响应及过多叶子明确报错', () => {
    expect(parseHttpSample('{').error).toContain('JSON')
    expect(parseHttpSample('{"value":1e999}').error).toContain('有限数值')
    expect(
      parseHttpSample(
        JSON.stringify(Array.from({ length: 201 }, (_, index) => index)),
      ).error,
    ).toContain('200')
    expect(
      parseHttpSample('['.repeat(34) + '1' + ']'.repeat(34)).error,
    ).toContain('32')
  })
  it.each(['$', '/data/0/value', '/a~1b~0c', '/'])(
    '接受有效 Pointer %s',
    (pointer) => {
      expect(validateHttpPointer(pointer)).toBeNull()
    },
  )
  it.each(['', 'data.value', '/bad~2escape', '/bad~'])(
    '拒绝无效 Pointer %s',
    (pointer) => {
      expect(validateHttpPointer(pointer)).not.toBeNull()
    },
  )
})
