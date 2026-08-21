/**
 * @fileoverview 契约：拖动几何浮标——移动示「x, y」、缩放示「w × h」（取整），
 * 挂在锚点左上角上方且按画布倍率反缩放；没在拖时整个浮标不存在。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import type { DragReadout } from '@/pages/DashboardEditor/scripts/canvasDrag'
import CanvasGuides from '@/pages/DashboardEditor/components/CanvasGuides.vue'

function readout(over: Partial<DragReadout> = {}): DragReadout {
  return {
    kind: 'move',
    x: 40,
    y: 20,
    w: 200,
    h: 100,
    left: 40,
    top: 20,
    ...over,
  }
}

function mountGuides(current: DragReadout | null, scale = 1) {
  return mount(CanvasGuides, {
    props: {
      guides: [],
      marquee: null,
      design: { width: 1920, height: 1080 },
      readout: current,
      scale,
    },
  })
}

describe('几何浮标', () => {
  it('移动显示「x, y」', () => {
    const wrapper = mountGuides(readout())

    expect(wrapper.get('.dt-readout').text()).toBe('40, 20')
  })

  it('缩放显示「w × h」', () => {
    const wrapper = mountGuides(readout({ kind: 'resize' }))

    expect(wrapper.get('.dt-readout').text()).toBe('200 × 100')
  })

  it('读数取整——拖动折算出的小数不进浮标', () => {
    const wrapper = mountGuides(readout({ x: 39.6, y: 20.4 }))

    expect(wrapper.get('.dt-readout').text()).toBe('40, 20')
  })

  it('挂在锚点位置并按倍率反缩放、上移一个自身高度加 4px', () => {
    const style = mountGuides(readout({ left: 300, top: 150 }), 2)
      .get('.dt-readout')
      .attributes('style')

    expect(style).toContain('left: 300px')
    expect(style).toContain('top: 150px')
    expect(style).toContain('scale(0.5) translate(0, calc(-100% - 4px))')
  })

  it('倍率异常（0）时按 1 兜底，不产生 Infinity', () => {
    const style = mountGuides(readout(), 0)
      .get('.dt-readout')
      .attributes('style')

    expect(style).toContain('scale(1)')
  })

  it('没在拖时浮标不存在', () => {
    const wrapper = mountGuides(null)

    expect(wrapper.find('.dt-readout').exists()).toBe(false)
  })
})

describe('框选矩形', () => {
  it('按框的几何摆出来，没在框选时不存在', async () => {
    const wrapper = mountGuides(null)
    expect(wrapper.find('.dt-marquee').exists()).toBe(false)

    await wrapper.setProps({ marquee: { x: 10, y: 20, w: 300, h: 200 } })

    const style = wrapper.get('.dt-marquee').attributes('style')
    expect(style).toContain('left: 10px')
    expect(style).toContain('top: 20px')
    expect(style).toContain('width: 300px')
    expect(style).toContain('height: 200px')
  })
})
