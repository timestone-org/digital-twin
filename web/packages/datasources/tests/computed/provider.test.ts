/**
 * @fileoverview 契约：计算绑定的诚实 null——任一输入不是有限数就整体算不出来，
 * 绝不做部分聚合。少一台机组的平均值看上去完全正常，但它是错的。
 */
import type { ComputeOp } from '@dt/contracts'
import { describe, expect, it } from 'vitest'

import {
  computeValue,
  createComputedProvider,
} from '../../src/computed/provider'

const VALUES = { a: 8, b: 2, c: 4 }

function compute(
  op: ComputeOp,
  inputs: string[],
  values: Record<string, unknown> = VALUES,
): number | null {
  return computeValue({ op, inputs }, values)
}

describe('七种运算符', () => {
  it.each([
    { op: 'sum' as const, expected: 14 },
    { op: 'avg' as const, expected: 14 / 3 },
    { op: 'min' as const, expected: 2 },
    { op: 'max' as const, expected: 8 },
    { op: 'product' as const, expected: 64 },
    { op: 'diff' as const, expected: 2 },
  ])('$op 按定义算出结果', ({ op, expected }) => {
    expect(compute(op, ['a', 'b', 'c'])).toBe(expected)
  })

  it('diff 是首项减去其余之和', () => {
    expect(compute('diff', ['a', 'b'])).toBe(6)
    expect(compute('diff', ['b', 'a'])).toBe(-6)
  })

  it('ratio 是前一项除以后一项', () => {
    expect(compute('ratio', ['a', 'c'])).toBe(2)
  })

  it('单个输入的 diff 就是它自己', () => {
    expect(compute('diff', ['a'])).toBe(8)
  })
})

describe('诚实的 null', () => {
  it('输入的槽还没有值时整体算不出来', () => {
    expect(compute('sum', ['a', '不存在的槽'])).toBeNull()
  })

  it('输入是字符串时算不出来，不做 Number 转换', () => {
    expect(compute('sum', ['a', 'b'], { a: 8, b: '2.50' })).toBeNull()
  })

  it('输入是 NaN 或无穷大时算不出来', () => {
    expect(compute('avg', ['a', 'b'], { a: 8, b: Number.NaN })).toBeNull()
    expect(
      compute('avg', ['a', 'b'], { a: 8, b: Number.POSITIVE_INFINITY }),
    ).toBeNull()
  })

  it('输入是 null 或布尔时算不出来', () => {
    expect(compute('sum', ['a', 'b'], { a: 8, b: null })).toBeNull()
    expect(compute('sum', ['a', 'b'], { a: 8, b: true })).toBeNull()
  })

  it('一个输入都没有时给 null 而不是 0', () => {
    expect(compute('sum', [])).toBeNull()
    expect(compute('avg', [])).toBeNull()
    expect(compute('product', [])).toBeNull()
  })

  it('部分输入可用也不做部分聚合', () => {
    expect(compute('sum', ['a', 'b', '不存在的槽'])).toBeNull()
  })

  it('ratio 除以零给 null 而不是无穷大', () => {
    expect(compute('ratio', ['a', 'z'], { a: 8, z: 0 })).toBeNull()
  })

  it('ratio 的输入不是两个时算不出来', () => {
    expect(compute('ratio', ['a'])).toBeNull()
    expect(compute('ratio', ['a', 'b', 'c'])).toBeNull()
  })

  it('结果溢出成无穷大时给 null', () => {
    expect(compute('product', ['a', 'b'], { a: 1e308, b: 1e308 })).toBeNull()
  })
})

describe('小数位', () => {
  it('按 precision 四舍五入', () => {
    expect(
      computeValue({ op: 'avg', inputs: ['a', 'b'], precision: 2 }, VALUES),
    ).toBe(5)
    expect(
      computeValue({ op: 'ratio', inputs: ['b', 'c'], precision: 3 }, VALUES),
    ).toBe(0.5)
    expect(
      computeValue(
        { op: 'avg', inputs: ['a', 'b', 'c'], precision: 2 },
        VALUES,
      ),
    ).toBe(4.67)
  })

  it('没给 precision 时不动结果', () => {
    expect(computeValue({ op: 'avg', inputs: ['a', 'b', 'c'] }, VALUES)).toBe(
      14 / 3,
    )
    expect(
      computeValue(
        { op: 'avg', inputs: ['a', 'b', 'c'], precision: null },
        VALUES,
      ),
    ).toBe(14 / 3)
  })

  it('precision 不是 0 到 20 的整数时按没给处理', () => {
    const inputs = ['a', 'b', 'c']
    expect(computeValue({ op: 'avg', inputs, precision: 1.5 }, VALUES)).toBe(
      14 / 3,
    )
    expect(computeValue({ op: 'avg', inputs, precision: -1 }, VALUES)).toBe(
      14 / 3,
    )
    expect(computeValue({ op: 'avg', inputs, precision: 21 }, VALUES)).toBe(
      14 / 3,
    )
  })
})

describe('计算 provider', () => {
  it('认 computed 这一种来源', () => {
    expect(createComputedProvider().kind).toBe('computed')
  })

  it('拿点位来订阅时说破这条绑定接错了来源', () => {
    expect(() =>
      createComputedProvider().subscribe(['src-1:temp'], () => undefined),
    ).toThrowError(/没有可订阅的点位/)
  })

  it('一个点位都没有时给一个可安全调用的退订', () => {
    expect(
      createComputedProvider().subscribe([], () => undefined)(),
    ).toBeUndefined()
  })

  it('读历史一律拒绝，不给空序列', async () => {
    await expect(
      createComputedProvider().readHistory({
        nodeKey: 'src-1:temp',
        range: { lastWindow: '1h' },
      }),
    ).rejects.toMatchObject({ code: 'unsupported-history' })
  })
})
