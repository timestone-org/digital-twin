/**
 * @fileoverview 分页算术的边界契约：0 条也有一页、末页只算到实际条数、
 * 页码窗口在首/中/尾三个位置的形状，以及越界页码被收回。
 */
import { describe, expect, it } from 'vitest'

import {
  buildPageItems,
  clampPage,
  itemRange,
  pageCount,
} from '../../../src/components/DtPagination/pages'

/** 把页码序列压成一行好读的字符串，省略号写成 `…`。 */
function shape(current: number, count: number): string {
  return buildPageItems(current, count)
    .map((item) => (item.kind === 'gap' ? '…' : String(item.page)))
    .join(' ')
}

describe('pageCount', () => {
  it.each([
    [0, 10, 1],
    [1, 10, 1],
    [10, 10, 1],
    [11, 10, 2],
    [95, 10, 10],
    [100, 20, 5],
  ])('总 %i 条、每页 %i 条 → %i 页', (total, size, expected) => {
    expect(pageCount(total, size)).toBe(expected)
  })

  it('一条都没有也算一页——页码条整个消失时用户以为控件坏了', () => {
    expect(pageCount(0, 20)).toBe(1)
  })

  it('每页条数非法时退回一页，而不是除出 Infinity', () => {
    expect(pageCount(50, 0)).toBe(1)
    expect(pageCount(50, -10)).toBe(1)
  })
})

describe('clampPage', () => {
  it.each([
    [0, 10, 1],
    [-3, 10, 1],
    [1, 10, 1],
    [7, 10, 7],
    [10, 10, 10],
    [11, 10, 10],
    [999, 10, 10],
  ])('页码 %i（共 %i 页）收回成 %i', (page, count, expected) => {
    expect(clampPage(page, count)).toBe(expected)
  })

  it('NaN 与 Infinity 落回第一页而不是渗进渲染', () => {
    expect(clampPage(Number.NaN, 10)).toBe(1)
    expect(clampPage(Number.POSITIVE_INFINITY, 10)).toBe(1)
  })

  it('小数页码截断取整', () => {
    expect(clampPage(3.9, 10)).toBe(3)
  })
})

describe('itemRange', () => {
  it('首页从第 1 条起', () => {
    expect(itemRange(1, 10, 95)).toEqual({ from: 1, to: 10 })
  })

  it('中间页按整页推进', () => {
    expect(itemRange(4, 10, 95)).toEqual({ from: 31, to: 40 })
  })

  it('末页只算到实际条数，不报出不存在的第 100 条', () => {
    expect(itemRange(10, 10, 95)).toEqual({ from: 91, to: 95 })
  })

  it('一条都没有时两端都是 0', () => {
    expect(itemRange(1, 10, 0)).toEqual({ from: 0, to: 0 })
  })

  it('总数不足一页时上界就是总数', () => {
    expect(itemRange(1, 20, 3)).toEqual({ from: 1, to: 3 })
  })
})

describe('buildPageItems', () => {
  it('只有一页时也给出这一页，页码条不空着', () => {
    expect(shape(1, 1)).toBe('1')
  })

  it('七页以内全部直出，不省略', () => {
    expect(shape(4, 7)).toBe('1 2 3 4 5 6 7')
  })

  it('八页起且停在前段时，只在右侧折省略号', () => {
    expect(shape(1, 8)).toBe('1 2 3 4 … 8')
    expect(shape(3, 8)).toBe('1 2 3 4 … 8')
  })

  it('停在中段时两侧各折一次', () => {
    expect(shape(5, 9)).toBe('1 … 4 5 6 … 9')
  })

  it('停在后段时只在左侧折省略号', () => {
    expect(shape(20, 20)).toBe('1 … 17 18 19 20')
    expect(shape(18, 20)).toBe('1 … 17 18 19 20')
  })

  it('首尾两页常驻——它们是跳到头尾唯一的一步入口', () => {
    const items = buildPageItems(50, 100)
    expect(items[0]).toEqual({ kind: 'page', page: 1, key: 'p1' })
    expect(items[items.length - 1]).toEqual({
      kind: 'page',
      page: 100,
      key: 'p100',
    })
  })

  it('省略号紧邻首尾时不出现——那会把一个页码换成一个点不出去的点', () => {
    expect(shape(4, 9)).toBe('1 … 3 4 5 … 9')
    expect(shape(2, 9)).toBe('1 2 3 4 … 9')
  })

  it('每一项的 key 互不相同，v-for 才不会拿下标凑合', () => {
    const keys = buildPageItems(5, 20).map((item) => item.key)
    expect(new Set(keys).size).toBe(keys.length)
  })
})
