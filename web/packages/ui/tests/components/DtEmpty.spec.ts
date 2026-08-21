/**
 * @fileoverview DtEmpty 的两档契约：block 是居中卡片档（缺省 alert-circle 26px），
 * inline 是单行行内档（icon 仅显式传入才渲染，12px）。
 * ⚠ prop 名写错时 typecheck 与 lint 双双放行，每个 prop 都要有一条断言它生效的用例。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import DtEmpty from '../../src/components/DtEmpty/DtEmpty.vue'

describe('block 档（缺省）', () => {
  it('缺省渲染 alert-circle 26px 图标与「暂无数据」', () => {
    const wrapper = mount(DtEmpty)
    const svg = wrapper.find('svg')
    expect(svg.exists()).toBe(true)
    expect(svg.attributes('width')).toBe('26')
    expect(wrapper.find('.dt-empty__title').text()).toBe('暂无数据')
    expect(wrapper.classes()).not.toContain('dt-empty--inline')
  })

  it('显式 icon 盖过缺省的 alert-circle，尺寸仍是 26px', () => {
    const withIcon = mount(DtEmpty, { props: { icon: 'layers' } })
    const fallback = mount(DtEmpty)
    expect(withIcon.find('svg').attributes('width')).toBe('26')
    // 两个名字画的是不同 path，形状不同才说明 icon prop 真的生效了
    expect(withIcon.find('svg').html()).not.toBe(fallback.find('svg').html())
  })

  it('title 与 hint 都渲染原文案，宽字符不截断', () => {
    const wrapper = mount(DtEmpty, {
      props: { title: '还没有可用事件 🈳', hint: '抽取完成后这里会有内容。' },
    })
    expect(wrapper.find('.dt-empty__title').text()).toBe('还没有可用事件 🈳')
    expect(wrapper.find('.dt-empty__hint').text()).toBe(
      '抽取完成后这里会有内容。',
    )
  })

  it('不传 hint 就没有 hint 节点，不留空行', () => {
    const wrapper = mount(DtEmpty)
    expect(wrapper.find('.dt-empty__hint').exists()).toBe(false)
  })

  it('默认插槽透传，可以塞一颗行动按钮', () => {
    const wrapper = mount(DtEmpty, { slots: { default: '<b class="cta" />' } })
    expect(wrapper.find('.cta').exists()).toBe(true)
  })
})

describe('inline 档', () => {
  it('size=inline 落行内修饰类', () => {
    const wrapper = mount(DtEmpty, { props: { size: 'inline' } })
    expect(wrapper.classes()).toContain('dt-empty--inline')
  })

  it('icon 不显式传入就不渲染图标——单行空态不给缺省图', () => {
    const wrapper = mount(DtEmpty, {
      props: { size: 'inline', title: '还没有字段' },
    })
    expect(wrapper.find('svg').exists()).toBe(false)
    expect(wrapper.find('.dt-empty__title').text()).toBe('还没有字段')
  })

  it('icon 显式传入才渲染，且压到 12px', () => {
    const wrapper = mount(DtEmpty, {
      props: { size: 'inline', icon: 'search' },
    })
    const svg = wrapper.find('svg')
    expect(svg.exists()).toBe(true)
    expect(svg.attributes('width')).toBe('12')
  })

  it('inline 也渲染 hint，原文案一字不动', () => {
    const wrapper = mount(DtEmpty, {
      props: { size: 'inline', title: '没有匹配的图标名', hint: '换个词试试' },
    })
    expect(wrapper.find('.dt-empty__hint').text()).toBe('换个词试试')
  })
})
