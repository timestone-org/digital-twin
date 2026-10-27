/** @fileoverview 参数文档拒绝畸形结构并忠实呈现 Schema。 */
import { describe, expect, it } from 'vitest'
import {
  parameterFields,
  parseConfiguration,
} from '@/pages/Modeling/Instance/scripts/parameters'

describe('完整参数文档', () => {
  it.each([
    '[1]',
    '{}',
    '{"nodes":[]}',
    '{"nodes":{"s":null}}',
    '{"nodes":{},"graph":{}}',
    '{',
  ])('拒绝无效文档 %s', (text) => {
    expect(parseConfiguration(text).value).toBeNull()
    expect(parseConfiguration(text).error).not.toBe('')
  })
  it('保留零值、空列表与节点参数', () => {
    expect(
      parseConfiguration('{"nodes":{"a":{"enabled":false,"n":0,"columns":[]}}}')
        .value,
    ).toEqual({ nodes: { a: { enabled: false, n: 0, columns: [] } } })
  })
  it('从 schema 推导枚举、必填、数字与复杂参数控件', () => {
    const fields = parameterFields({
      required: ['source'],
      properties: {
        source: { type: 'string', title: '数据源' },
        count: { type: 'integer' },
        mode: { enum: ['first', 'last'], type: 'string' },
        rules: { type: 'object' },
      },
    })
    expect(
      fields.map(({ key, kind, required }) => ({ key, kind, required })),
    ).toEqual([
      { key: 'source', kind: 'string', required: true },
      { key: 'count', kind: 'number', required: false },
      { key: 'mode', kind: 'select', required: false },
      { key: 'rules', kind: 'json', required: false },
    ])
  })
})

it('解析算子 Schema 内的枚举引用', () => {
  const fields = parameterFields({
    $defs: { Source: { type: 'string', enum: ['manual', 'collect'] } },
    properties: { source: { $ref: '#/$defs/Source', title: '行来源' } },
  })
  expect(fields[0]).toMatchObject({
    kind: 'select',
    label: '行来源',
    options: [
      { value: 'manual', label: 'manual' },
      { value: 'collect', label: 'collect' },
    ],
  })
})
