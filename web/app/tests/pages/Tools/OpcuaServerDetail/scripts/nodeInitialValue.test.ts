/** @fileoverview 初值解析的精度、边界和支持类型。 */
import { describe, expect, it } from 'vitest'
import type { OpcuaDataType } from '@dt/contracts'

import {
  CREATABLE_DATA_TYPES,
  parseInitialValue,
} from '@/pages/Tools/OpcuaServerDetail/scripts/nodeInitialValue'

describe('初值解析', () => {
  it.each<{ dataType: OpcuaDataType; raw: string; value: unknown }>([
    { dataType: 'double', raw: '', value: undefined },
    { dataType: 'int32', raw: '  ', value: undefined },
    { dataType: 'double', raw: '  -1.25e2  ', value: -125 },
    { dataType: 'double', raw: '.5', value: 0.5 },
    { dataType: 'double', raw: '0', value: 0 },
    { dataType: 'int32', raw: '2147483647', value: 2147483647 },
    { dataType: 'int64', raw: '-9007199254740991', value: -9007199254740991 },
    { dataType: 'boolean', raw: ' false ', value: false },
    { dataType: 'string', raw: '  文本  ', value: '  文本  ' },
  ])('$dataType / $raw 正确解析', ({ dataType, raw, value }) => {
    expect(parseInitialValue(raw, dataType)).toEqual({ value, error: null })
  })

  it.each<{ dataType: OpcuaDataType; raw: string }>([
    { dataType: 'double', raw: '0x10' },
    { dataType: 'double', raw: 'NaN' },
    { dataType: 'double', raw: '-Infinity' },
    { dataType: 'int32', raw: '-2147483649' },
    { dataType: 'int64', raw: '-9007199254740992' },
    { dataType: 'int64', raw: '9223372036854775807' },
    { dataType: 'int64', raw: '1e2' },
    { dataType: 'boolean', raw: '0' },
    { dataType: 'guid', raw: '' },
    { dataType: 'datetime', raw: '2026-10-04' },
  ])('$dataType / $raw 明确拒绝', ({ dataType, raw }) => {
    const result = parseInitialValue(raw, dataType)
    expect(result.value).toBeUndefined()
    expect(result.error).toBeTruthy()
  })

  it('只提供当前运行时可执行的七类', () => {
    expect(CREATABLE_DATA_TYPES).toEqual([
      'boolean',
      'int32',
      'int64',
      'float',
      'double',
      'string',
      'byte_string',
    ])
  })
  it.each([
    { raw: '1e40', dataType: 'float', isValid: false },
    { raw: '-1e40', dataType: 'float', isValid: false },
    { raw: '3.4028234663852886e38', dataType: 'float', isValid: true },
    { raw: '-3.4028234663852886e38', dataType: 'float', isValid: true },
    { raw: '1e40', dataType: 'double', isValid: true },
  ] as const)(
    '$dataType 的 $raw 符合实际编码范围',
    ({ raw, dataType, isValid }) => {
      const parsed = parseInitialValue(raw, dataType)
      expect(parsed.error === null).toBe(isValid)
      if (isValid) expect(parsed.value).toBe(Number(raw))
    },
  )
})
