/**
 * @fileoverview 标注层守的契约：一层画一档 `zOrder` 的全部标注、文档序即绘制序、
 * `viewBox` 跟着画布走且有除零护栏。
 *
 * ⚠ 这几件事错了都不报错：`viewBox` 塌成 `0 0 0 0` 时整层什么都不画，看起来像
 * 「这一层没数据」；顺序反了只是「后画的标注压在先画的上面」。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import { normalizeMarks } from '../../src/normalizeMarks'
import Twin2dMarkLayer from '../../src/render/Twin2dMarkLayer.vue'

/** 两条标注：一个框一条线，id 不同名好断顺序。 */
const MARKS = normalizeMarks([
  { id: 'm1', kind: 'rect', x: 10, y: 10, w: 100, h: 50 },
  { id: 'm2', kind: 'line', x: 0, y: 0, x2: 80, y2: 40 },
])

function render(width = 400, height = 200, marks = MARKS) {
  return mount(Twin2dMarkLayer, { props: { marks, width, height } })
}

describe('标注层', () => {
  it('逐条画出形状，文档序即绘制序', () => {
    const wrapper = render()

    expect(
      wrapper.findAll('[data-test="mark"]').map((n) => n.attributes('data-id')),
    ).toEqual(['m1', 'm2'])
    wrapper.unmount()
  })

  it('一条标注都没有时层还在，只是空的', () => {
    const wrapper = render(400, 200, [])
    // ⚠ 先落到一个有类型的根上：`.vue` 的模块在 typescript-eslint 眼里是 any，
    // 直接在 `wrapper.element` 上查 DOM 会整串判成不安全调用
    const root: Element = wrapper.element

    expect(root.tagName.toLowerCase()).toBe('svg')
    expect(wrapper.findAll('[data-test="mark"]')).toHaveLength(0)
    wrapper.unmount()
  })

  it('viewBox 与宽高跟着画布走', () => {
    const wrapper = render(640, 360)

    expect(wrapper.attributes('viewBox')).toBe('0 0 640 360')
    expect([wrapper.attributes('width'), wrapper.attributes('height')]).toEqual(
      ['640', '360'],
    )
    wrapper.unmount()
  })

  // ⚠ `0 0 0 0` 会让整层静默不画，护栏不能省
  it('画布尺寸不是正数时 viewBox 退到 1，而不是塌成零', () => {
    const wrapper = render(0, Number.NaN)

    expect(wrapper.attributes('viewBox')).toBe('0 0 1 1')
    wrapper.unmount()
  })

  // ⚠ 吃了指针的话铺满整块画布的图框会把底下的节点全挡掉，而界面上看不出异常
  it('整层挂着不吃指针的那个类，且不进无障碍树', () => {
    const wrapper = render()

    expect(wrapper.classes()).toContain('t2-marks')
    expect(wrapper.attributes('aria-hidden')).toBe('true')
    wrapper.unmount()
  })
})
