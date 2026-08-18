/**
 * @fileoverview 契约：筛出来是空的 ≠ 这里本来就没有。
 *
 * ⚠ 这条口径守的不是文案好不好看，而是**不许给出会让人做错事的引导**：
 * 搜不到时提示「去导入」，工程师真的会再导一遍。
 */
import { describe, expect, it } from 'vitest'

import { listEmptyState } from '@/utils/listEmpty'

const BLANK = { title: '尚未导入点位', hint: '在左侧浏览树中勾选并导入。' }

describe('没有筛选条件时', () => {
  it('原样给各页自己写的引导：只有它们知道下一步该去哪', () => {
    const state = listEmptyState({
      isFiltered: false,
      subject: '点位',
      keyword: '',
      blank: BLANK,
    })

    expect(state).toEqual(BLANK)
  })

  it('关键词只有空白也算没筛：空格不该把引导换掉', () => {
    const state = listEmptyState({
      isFiltered: false,
      subject: '点位',
      keyword: '   ',
      blank: BLANK,
    })

    expect(state).toEqual(BLANK)
  })
})

describe('筛出来是空的时候', () => {
  it('说的是没匹配上，而不是一个都没有', () => {
    const state = listEmptyState({
      isFiltered: true,
      subject: '点位',
      keyword: 'temp',
      blank: BLANK,
    })

    expect(state.title).toBe('没有匹配的点位')
    expect(state.hint).toContain('temp')
  })

  it('绝不留下「去导入 / 去新建」这类引导', () => {
    const state = listEmptyState({
      isFiltered: true,
      subject: '点位',
      keyword: 'temp',
      blank: BLANK,
    })

    expect(state.hint).not.toContain('导入')
    expect(state.title).not.toBe(BLANK.title)
  })

  it('只按下拉筛选时不提「名字含」：那时候根本没输过词', () => {
    const state = listEmptyState({
      isFiltered: true,
      subject: '空调',
      keyword: '',
      blank: { title: '还没有空调' },
    })

    expect(state.title).toBe('没有匹配的空调')
    expect(state.hint).toContain('换个条件')
    expect(state.hint).not.toContain('名字含')
  })

  it('关键词两头的空白不带进文案里', () => {
    const state = listEmptyState({
      isFiltered: true,
      subject: '点位',
      keyword: '  temp  ',
      blank: BLANK,
    })

    expect(state.hint).toContain('「temp」')
  })
})
