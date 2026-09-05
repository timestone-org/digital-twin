/**
 * @fileoverview 散点块的算料：认得出画法、坏点不进图、认不出的整张不画。
 */
import { describe, expect, it } from 'vitest'

import { cloudPanels } from '@/pages/Modeling/Canvas/scripts/fitClouds'

function payloadOf(over: Record<string, unknown> = {}) {
  return {
    clouds: [
      {
        key: 'residual',
        name: '残差',
        mode: 'residual',
        x_label: '预测值（千瓦时）',
        y_label: '残差（千瓦时）',
        points: [
          [1, 0.5],
          [2, -0.25],
        ],
        ...over,
      },
    ],
  }
}

describe('散点块的算料', () => {
  it('一张图折成一路序列，两根轴的名字照原样带过来', () => {
    const [panel] = cloudPanels(payloadOf())

    expect(panel?.mode).toBe('residual')
    expect(panel?.xLabel).toBe('预测值（千瓦时）')
    expect(panel?.yLabel).toBe('残差（千瓦时）')
    expect(panel?.series[0]?.points).toEqual([
      [1, 0.5],
      [2, -0.25],
    ])
  })

  // ⚠ 认不出的画法整张不画：退回默认那一档会给残差图配上一条「理想线」，
  // 而残差图上根本没有这条线的意思
  it('认不出的画法整张不画，不退回默认那一档', () => {
    expect(cloudPanels(payloadOf({ mode: 'series' }))).toEqual([])
    expect(cloudPanels(payloadOf({ mode: '' }))).toEqual([])
  })

  it('两轴同尺那一档认得出来', () => {
    expect(cloudPanels(payloadOf({ mode: 'pairs' }))[0]?.mode).toBe('pairs')
  })

  // ⚠ 缺一个坐标的点整点丢掉：补 0 会在轴上落一个本来不存在的点
  it('坐标不是有限数的点整点丢掉，别的点照画', () => {
    const [panel] = cloudPanels(
      payloadOf({
        points: [[1, 2], [3], [Number.NaN, 4], ['5', 6], [7, 8]],
      }),
    )

    expect(panel?.series[0]?.points).toEqual([
      [1, 2],
      [7, 8],
    ])
  })

  it('一个点都不剩时这一张整个不出现', () => {
    expect(cloudPanels(payloadOf({ points: [] }))).toEqual([])
  })

  it('整包读不出来时给空数组，不抛错', () => {
    expect(cloudPanels({})).toEqual([])
    expect(cloudPanels({ clouds: '不是数组' })).toEqual([])
    expect(cloudPanels({ clouds: [null] })).toEqual([])
  })

  it('同一块上的两张图各有各的键，不撞在一起', () => {
    const payload = payloadOf()
    const clouds = payload.clouds
    const keys = cloudPanels({ clouds: [...clouds, ...clouds] }).map(
      (one) => one.key,
    )

    expect(new Set(keys).size).toBe(2)
  })
})
