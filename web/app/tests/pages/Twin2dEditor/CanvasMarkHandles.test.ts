/**
 * @fileoverview 契约：选中标注的把手——有框的两档出八向缩放手柄、辅助线出两个端点
 * 手柄，且手柄尺寸按倍率反算成恒定的屏幕尺寸。
 *
 * ⚠ 手柄跟着舞台一起缩放的话，缩到四分之一时它只剩两三个像素，谁也点不中，而画面
 * 看起来一切正常。
 * ⚠ 起手必须拦下冒泡：不拦的话画布背景会同时起一次框选，表现是「一拖手柄就把整片
 * 框选上」。
 */
import { normalizeMark } from '@dt/twin2d'
import type { Twin2dMark } from '@dt/twin2d'
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import CanvasMarkHandles from '@/pages/Twin2dEditor/components/CanvasMarkHandles.vue'

/** 造一条归一化过的标注。 */
function markOf(raw: Record<string, unknown>): Twin2dMark {
  const mark = normalizeMark(raw)
  if (mark === null) throw new Error('标注造不出来')
  return mark
}

/** 左上角 (100, 50)、200 × 80 的辅助框。 */
const BOX = markOf({ id: 'm1', kind: 'rect', x: 100, y: 50, w: 200, h: 80 })
/** (10, 20) → (110, 80) 的辅助线。 */
const LINE = markOf({ id: 'l1', kind: 'line', x: 10, y: 20, x2: 110, y2: 80 })

function mountHandles(mark: Twin2dMark, scale = 1) {
  return mount(CanvasMarkHandles, { props: { mark, scale } })
}

/** 起手：真事件才带得上 `stopPropagation` 这类可断言的行为。 */
function pointerDown(): PointerEvent {
  return new PointerEvent('pointerdown', { clientX: 0, clientY: 0 })
}

describe('八向缩放手柄', () => {
  it('有框那两档各出八枚，方向不重样', () => {
    const wrapper = mountHandles(BOX)
    const dirs = wrapper
      .findAll('[data-test="mark-handle"]')
      .map((handle) => handle.attributes('data-dir'))

    expect(dirs).toEqual([
      '-1,-1',
      '0,-1',
      '1,-1',
      '1,0',
      '1,1',
      '0,1',
      '-1,1',
      '-1,0',
    ])
    wrapper.unmount()
  })

  it('每一枚都以它那条边的中点居中', () => {
    const wrapper = mountHandles(BOX)
    const corner = wrapper.find('[data-dir="-1,-1"]')
    const bottomRight = wrapper.find('[data-dir="1,1"]')

    expect([corner.attributes('x'), corner.attributes('y')]).toEqual([
      '95.5',
      '45.5',
    ])
    expect([bottomRight.attributes('x'), bottomRight.attributes('y')]).toEqual([
      '295.5',
      '125.5',
    ])
    wrapper.unmount()
  })

  it('放大一倍时手柄的设计边长减半，屏幕上还是那么大', () => {
    const wrapper = mountHandles(BOX, 2)
    const corner = wrapper.find('[data-dir="-1,-1"]')

    expect(corner.attributes('width')).toBe('4.5')
    expect(corner.attributes('x')).toBe('97.75')
    wrapper.unmount()
  })

  it('倍率非正时按原尺寸画，不产出负边长', () => {
    const wrapper = mountHandles(BOX, 0)

    expect(
      Number(wrapper.find('[data-dir="1,1"]').attributes('width')),
    ).toBeGreaterThan(0)
    wrapper.unmount()
  })

  it('角上是对角线指针、边上是正交指针', () => {
    const wrapper = mountHandles(BOX)

    expect(wrapper.find('[data-dir="-1,-1"]').attributes('style')).toContain(
      'nwse-resize',
    )
    expect(wrapper.find('[data-dir="1,-1"]').attributes('style')).toContain(
      'nesw-resize',
    )
    expect(wrapper.find('[data-dir="0,-1"]').attributes('style')).toContain(
      'ns-resize',
    )
    expect(wrapper.find('[data-dir="1,0"]').attributes('style')).toContain(
      'ew-resize',
    )
    wrapper.unmount()
  })

  it('起手把方向原样抛上去', () => {
    const wrapper = mountHandles(BOX)

    wrapper.find('[data-dir="1,1"]').element.dispatchEvent(pointerDown())

    expect(wrapper.emitted('resize')?.[0]?.[0]).toEqual({ x: 1, y: 1 })
    wrapper.unmount()
  })

  it('起手拦下冒泡与默认动作', () => {
    const wrapper = mountHandles(BOX)
    const event = pointerDown()
    const stop = vi.spyOn(event, 'stopPropagation')
    const prevent = vi.spyOn(event, 'preventDefault')

    wrapper.find('[data-dir="1,1"]').element.dispatchEvent(event)

    expect(stop).toHaveBeenCalledOnce()
    expect(prevent).toHaveBeenCalledOnce()
    wrapper.unmount()
  })
})

describe('辅助线的端点手柄', () => {
  it('只出两枚端点，一枚缩放手柄都没有', () => {
    const wrapper = mountHandles(LINE)

    expect(wrapper.findAll('[data-test="mark-handle"]')).toHaveLength(0)
    expect(wrapper.findAll('[data-test="mark-endpoint"]')).toHaveLength(2)
    wrapper.unmount()
  })

  it('两枚各自钉在起点与终点上', () => {
    const wrapper = mountHandles(LINE)
    const [first, second] = wrapper.findAll('[data-test="mark-endpoint"]')

    expect([first?.attributes('cx'), first?.attributes('cy')]).toEqual([
      '10',
      '20',
    ])
    expect([second?.attributes('cx'), second?.attributes('cy')]).toEqual([
      '110',
      '80',
    ])
    wrapper.unmount()
  })

  it('起手抛的是端点序号', () => {
    const wrapper = mountHandles(LINE)
    const second = wrapper.findAll('[data-test="mark-endpoint"]')[1]

    second?.element.dispatchEvent(pointerDown())

    expect(wrapper.emitted('endpoint')?.[0]?.[0]).toBe(1)
    wrapper.unmount()
  })
})

describe('选中框', () => {
  it('有框那两档画成矩形轮廓', () => {
    const wrapper = mountHandles(BOX)
    const outline = wrapper.find('[data-test="mark-outline"]')

    expect(outline.element.tagName.toLowerCase()).toBe('rect')
    expect(outline.attributes('vector-effect')).toBe('non-scaling-stroke')
    wrapper.unmount()
  })

  it('辅助线的轮廓跟着线走，不套一个框', () => {
    const wrapper = mountHandles(LINE)
    const outline = wrapper.find('[data-test="mark-outline"]')

    expect(outline.element.tagName.toLowerCase()).toBe('line')
    wrapper.unmount()
  })
})
