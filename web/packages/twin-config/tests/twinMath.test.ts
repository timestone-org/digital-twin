/**
 * @fileoverview 锁住缝合与派生的两条契约：数组行按文档序对齐成 id 映射，
 * 以及「一个值都没有」时返回同一个冻结空引用（每帧新建空对象会让下游 watch 空转）。
 * 另锁非有限数在读值与格式化两处都被清掉，不许上屏成字面的 "NaN"。
 */
import { describe, expect, it } from 'vitest'

import {
  EMPTY_ANCHOR_VALUES,
  formatAnchorText,
  stitchAnchorValues,
} from '../src/twinMath'
import { normalizeTwinConfig } from '../src/types'
import type { TwinAnchor } from '../src/types'

const CONFIG = normalizeTwinConfig({
  anchors: [
    { id: 'a-in', label: '进口', unit: '℃', decimals: 1 },
    { id: 'a-out', label: '出口' },
  ],
})

function anchorAt(index: number): TwinAnchor {
  const anchor = CONFIG.anchors[index]
  if (anchor === undefined) throw new Error(`夹具缺第 ${index} 个锚点`)
  return anchor
}

describe('stitchAnchorValues', () => {
  it('第 i 行喂给文档序第 i 个锚点', () => {
    expect(
      stitchAnchorValues(CONFIG.anchors, [{ value: 25.5 }, { value: 0 }]),
    ).toEqual({ 'a-in': { value: 25.5 }, 'a-out': { value: 0 } })
  })

  it('行数少于锚点数时后面的锚点没有值', () => {
    expect(stitchAnchorValues(CONFIG.anchors, [{ value: 1 }])).toEqual({
      'a-in': { value: 1 },
    })
  })

  it('多出来的行不产生条目', () => {
    const stitched = stitchAnchorValues(
      [anchorAt(0)],
      [{ value: 1 }, { value: 2 }],
    )
    expect(Object.keys(stitched)).toEqual(['a-in'])
  })

  it('行不是对象时按无值处理', () => {
    expect(stitchAnchorValues(CONFIG.anchors, ['nope', null])).toBe(
      EMPTY_ANCHOR_VALUES,
    )
  })

  it('非有限数在读值处就被清掉，于是该锚点没有条目', () => {
    expect(
      stitchAnchorValues(CONFIG.anchors, [
        { value: Number.POSITIVE_INFINITY },
        { value: 1 },
      ]),
    ).toEqual({ 'a-out': { value: 1 } })
  })

  it('一个值都没有时返回同一个冻结空引用', () => {
    expect(stitchAnchorValues(CONFIG.anchors, undefined)).toBe(
      EMPTY_ANCHOR_VALUES,
    )
    expect(stitchAnchorValues(undefined, [{ value: 1 }])).toBe(
      EMPTY_ANCHOR_VALUES,
    )
    expect(stitchAnchorValues(CONFIG.anchors, [])).toBe(
      stitchAnchorValues([], undefined),
    )
  })
})

describe('formatAnchorText', () => {
  it('前缀、数值、单位三段拼接', () => {
    expect(formatAnchorText(anchorAt(0), 25.46)).toBe('进口 25.5 ℃')
  })

  it('非有限数不上屏，只剩前缀与单位', () => {
    expect(formatAnchorText(anchorAt(0), Number.NaN)).toBe('进口 ℃')
    expect(formatAnchorText(anchorAt(0), Number.NEGATIVE_INFINITY)).toBe(
      '进口 ℃',
    )
  })

  it('缺值时只剩前缀与单位', () => {
    expect(formatAnchorText(anchorAt(0), null)).toBe('进口 ℃')
    expect(formatAnchorText(anchorAt(0), undefined)).toBe('进口 ℃')
  })

  it('不定位数时原样上屏后端的精确小数字符串', () => {
    expect(formatAnchorText(anchorAt(1), ' 12.500 ')).toBe('出口 12.500')
  })

  it('不定位数的数字按原值上屏', () => {
    expect(formatAnchorText(anchorAt(1), 12.5)).toBe('出口 12.5')
  })

  it('非数值文本原样上屏', () => {
    expect(formatAnchorText(anchorAt(1), '停机')).toBe('出口 停机')
  })

  it('布尔读数按字面上屏', () => {
    expect(formatAnchorText(anchorAt(1), true)).toBe('出口 true')
  })

  it('对象读数不上屏', () => {
    expect(formatAnchorText(anchorAt(1), { a: 1 })).toBe('出口')
  })
})
