/**
 * @fileoverview 守标题头的结构契约：没标题就不画竖条与文字、⚠ 一串空格也算没标题
 * （否则会画出一条有竖条、没有字的空标题栏）、装饰带必须排在右侧插槽之前，
 * 且插槽名写错既不报错也不渲染，只能靠这里的用例兜。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import ModuleTitleBar from '../../src/shared/ModuleTitleBar.vue'

describe('标题头的文字', () => {
  it('有标题时画竖条与文字', () => {
    const wrapper = mount(ModuleTitleBar, { props: { title: '能耗总览' } })

    expect(wrapper.get('.module-title-bar__text').text()).toBe('能耗总览')
    expect(wrapper.find('.panel-bar').exists()).toBe(true)
  })

  it('标题去首尾空白后再显示', () => {
    const wrapper = mount(ModuleTitleBar, { props: { title: '  能耗总览 ' } })

    expect(wrapper.get('.module-title-bar__text').text()).toBe('能耗总览')
  })

  it('没有标题时竖条与文字都不画', () => {
    const wrapper = mount(ModuleTitleBar)

    expect(wrapper.find('.module-title-bar__text').exists()).toBe(false)
    expect(wrapper.find('.panel-bar').exists()).toBe(false)
  })

  it('空标题与纯空白标题一视同仁', () => {
    for (const title of ['', '   ']) {
      const wrapper = mount(ModuleTitleBar, { props: { title } })

      expect(wrapper.find('.panel-bar').exists()).toBe(false)
    }
  })
})

describe('标题头的两侧', () => {
  it('没有标题时整条仍在，用来承载右侧插槽', () => {
    const wrapper = mount(ModuleTitleBar, {
      slots: { extra: '<button class="seg">2D</button>' },
    })

    expect(wrapper.find('.module-title-bar').exists()).toBe(true)
    expect(wrapper.get('.module-title-bar__extra .seg').text()).toBe('2D')
  })

  it('没传右侧插槽时不留空容器', () => {
    const wrapper = mount(ModuleTitleBar, { props: { title: '能耗总览' } })

    expect(wrapper.find('.module-title-bar__extra').exists()).toBe(false)
  })

  it('装饰带排在右侧插槽之前，且读屏跳过', () => {
    const wrapper = mount(ModuleTitleBar, {
      props: { title: '能耗总览' },
      slots: { extra: '<button class="seg">2D</button>' },
    })
    const classes = wrapper
      .findAll('.module-title-bar > *')
      .map((node) => node.classes()[0])

    expect(classes).toEqual([
      'panel-bar',
      'module-title-bar__text',
      'module-title-bar__rule',
      'module-title-bar__extra',
    ])
    expect(
      wrapper.get('.module-title-bar__rule').attributes('aria-hidden'),
    ).toBe('true')
  })
})
