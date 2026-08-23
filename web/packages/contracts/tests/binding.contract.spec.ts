/**
 * @fileoverview 契约：绑定来源、运算符与质量位三个闭合集合的成员。
 * ⚠ 来源集合放宽一个成员，拼错的 `opuca` 就会照常入库、永不产数据、无任何告警。
 */
import { describe, expect, it } from 'vitest'

import {
  BINDING_SOURCE_KINDS,
  COMPUTE_OPS,
  POINT_QUALITIES,
  datasetBindingKey,
  parseDatasetBindingKey,
} from '../src/index'
import type { BindingSourceKind, ComputeOp, PointQuality } from '../src/index'

const BINDING_SOURCE_KIND_MEMBERS: Record<BindingSourceKind, true> = {
  opcua: true,
  static: true,
  computed: true,
  archive: true,
  dataset: true,
}
const COMPUTE_OP_MEMBERS: Record<ComputeOp, true> = {
  sum: true,
  avg: true,
  min: true,
  max: true,
  product: true,
  diff: true,
  ratio: true,
}
const POINT_QUALITY_MEMBERS: Record<PointQuality, true> = {
  good: true,
  uncertain: true,
  bad: true,
}

describe('绑定来源', () => {
  it('来源是实时点位、常量、计算、点位历史、数据台账五种', () => {
    expect([...BINDING_SOURCE_KINDS]).toEqual([
      'opcua',
      'static',
      'computed',
      'archive',
      'dataset',
    ])
  })

  it('来源的类型成员与运行时常量对齐', () => {
    expect(Object.keys(BINDING_SOURCE_KIND_MEMBERS).sort()).toEqual(
      [...BINDING_SOURCE_KINDS].sort(),
    )
  })
})

describe('计算绑定', () => {
  it('运算符是这七种', () => {
    expect([...COMPUTE_OPS]).toEqual([
      'sum',
      'avg',
      'min',
      'max',
      'product',
      'diff',
      'ratio',
    ])
  })

  it('运算符的类型成员与运行时常量对齐', () => {
    expect(Object.keys(COMPUTE_OP_MEMBERS).sort()).toEqual(
      [...COMPUTE_OPS].sort(),
    )
  })
})

describe('质量位', () => {
  it('协议无关的三档与采集侧一致', () => {
    expect([...POINT_QUALITIES]).toEqual(['good', 'uncertain', 'bad'])
  })

  it('质量位的类型成员与运行时常量对齐', () => {
    expect(Object.keys(POINT_QUALITY_MEMBERS).sort()).toEqual(
      [...POINT_QUALITIES].sort(),
    )
  })
})

describe('台账列身份', () => {
  it('拼出来的串能原样拆回去', () => {
    const key = datasetBindingKey('energy_log', '进水量')

    expect(key).toBe('ds:energy_log:进水量')
    expect(parseDatasetBindingKey(key)).toEqual({
      code: 'energy_log',
      columnKey: '进水量',
    })
  })

  it.each(['energy_log:进水量', 'x:energy_log:进水量', 'ds:energy_log'])(
    '不合口径的 %s 拆出 null 而不是一个半对的结果',
    (key) => {
      // ⚠ 半对最坏：拿着一个错的编码去取数，后端只会说「没这张台账」
      expect(parseDatasetBindingKey(key)).toBeNull()
    },
  )

  it('多一个冒号就是这个串本身不对，不是列名里带了冒号', () => {
    // 列标识明令禁止冒号（DATASET_DESIGN §4.2），故切不成三段只能是串错了
    expect(parseDatasetBindingKey('ds:energy_log:a:b')).toBeNull()
  })

  it('空的编码或列标识不算数', () => {
    expect(parseDatasetBindingKey('ds::进水量')).toBeNull()
    expect(parseDatasetBindingKey('ds:energy_log:')).toBeNull()
  })
})
