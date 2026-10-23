/** @fileoverview 全判负类阈值的精度与滑杆展示回归。 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import ThresholdSlider from '@/pages/Modeling/Canvas/components/ThresholdSlider.vue'
import {
  buildThresholdGrid,
  standAt,
} from '@/pages/Modeling/Canvas/scripts/thresholdGrid'

function payloadAt(maximum: number, baseline: number) {
  return {
    baseline,
    items: [
      {
        name: maximum.toFixed(3),
        threshold: maximum,
        tp: 1,
        fp: 1,
        tn: 0,
        fn: 0,
        value: 2 / 3,
      },
      {
        name: '全判负类',
        threshold: baseline,
        tp: 0,
        fp: 0,
        tn: 1,
        fn: 1,
        value: 0,
      },
    ],
  }
}

describe('全判负类阈值边界', () => {
  it('相邻浮点数不是同一档，旧网格缺档时明确说出近似', () => {
    const baseline = 0.5000000000000001
    const payload = payloadAt(0.5, baseline)
    const grid = buildThresholdGrid(
      { ...payload, items: payload.items.slice(0, 1) },
      baseline,
    )

    expect(grid.isExact).toBe(false)
  })

  it.each([
    [0.4, 0.4000000000000001],
    [1, 1.0000000000000002],
  ])('最大概率 %s 时保留全判负类档和实际四格', (maximum, baseline) => {
    const grid = buildThresholdGrid(payloadAt(maximum, baseline), baseline)
    const stand = standAt(grid, grid.trainedSeat)

    expect(grid.rows[grid.trainedSeat]?.threshold).toBe(baseline)
    expect(grid.isExact).toBe(true)
    expect(stand.text).toBe('全判负类')
    expect(stand.matrix).toEqual([
      [0, 1],
      [0, 1],
    ])
    expect(stand.offset).toContain('全判负类')
    expect(stand.offset).toContain('同源')
  })

  it('默认滑杆说明全判负类，没有虚构判成正类的最低概率', () => {
    const wrapper = mount(ThresholdSlider, {
      props: { payload: payloadAt(1, 1.0000000000000002) },
    })

    expect(
      wrapper.find<HTMLInputElement>('input[type="range"]').element.value,
    ).toBe('1')
    expect(wrapper.text()).toContain('竖线是打分那一档：全判负类')
    expect(wrapper.text()).not.toContain('判成正类的最低概率')
    expect(wrapper.text()).toContain('判成正类 0 行')
  })
})
