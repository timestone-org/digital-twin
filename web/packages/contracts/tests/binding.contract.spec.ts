/**
 * @fileoverview 契约：绑定来源、运算符与质量位三个闭合集合的成员。
 * ⚠ 来源集合放宽一个成员，拼错的 `opuca` 就会照常入库、永不产数据、无任何告警。
 */
import { describe, expect, it } from 'vitest'

import {
  BINDING_SOURCE_KINDS,
  COMPUTE_OPS,
  POINT_QUALITIES,
} from '../src/index'
import type { BindingSourceKind, ComputeOp, PointQuality } from '../src/index'

const BINDING_SOURCE_KIND_MEMBERS: Record<BindingSourceKind, true> = {
  opcua: true,
  static: true,
  computed: true,
  archive: true,
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
  it('来源是实时点位、常量、计算、历史四种', () => {
    expect([...BINDING_SOURCE_KINDS]).toEqual([
      'opcua',
      'static',
      'computed',
      'archive',
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
