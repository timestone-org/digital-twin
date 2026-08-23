/**
 * @fileoverview 锁住趋势分析页的深链契约：跳转方与接收方共用同一份 query 键名。
 * ⚠ 两端各写一份字面量时写歪了完全静默——跳过去了、页面也开了，只是什么都
 * 没预选中，用户只会报「这个入口没做完」。
 */
import { describe, expect, it } from 'vitest'

import {
  TREND_PATH,
  datasetTrendTo,
  readTrendDeepLink,
} from '@/features/trend/trendLink'

describe('台账 → 趋势分析的深链', () => {
  it('跳转方产出的 query，接收方原样读得回来', () => {
    const to = datasetTrendTo('t-1')
    expect(to.path).toBe(TREND_PATH)
    expect(readTrendDeepLink(to.query)).toEqual({
      source: 'dataset',
      tableId: 't-1',
    })
  })

  it('⚠ 键名只有一份：两端都不许各写各的字面量', () => {
    // 这一条真正在守的是「跳转方与接收方共用同一个模块」——把 datasetTrendTo
    // 换成手写对象时，只要键名写歪一个字，上面那条就会红
    expect(Object.keys(datasetTrendTo('t-1').query).sort()).toEqual([
      'source',
      'tableId',
    ])
  })

  it('没带 source 时回落点位源，而不是白页', () => {
    expect(readTrendDeepLink({}).source).toBe('point')
  })

  it('不认识的 source 也回落点位源', () => {
    expect(readTrendDeepLink({ source: 'moon' }).source).toBe('point')
  })

  it('tableId 是重复键（数组）时当没传，让用户自己选', () => {
    expect(
      readTrendDeepLink({ source: 'dataset', tableId: ['a', 'b'] }).tableId,
    ).toBe(null)
  })

  it('tableId 是空串时当没传', () => {
    expect(readTrendDeepLink({ source: 'dataset', tableId: '' }).tableId).toBe(
      null,
    )
  })
})
