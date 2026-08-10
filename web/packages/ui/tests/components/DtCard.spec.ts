/**
 * @fileoverview DtCard 的行为契约：标题区按需出现、四角括号是四个而不是两个、
 * 内边距档位落到类名上。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import DtCard from '../../src/components/DtCard/DtCard.vue'

describe('DtCard', () => {
  it('没有标题也没有插槽时不渲染空的标题区', () => {
    const wrapper = mount(DtCard, { slots: { default: '正文' } })
    expect(wrapper.find('.dt-card__hd').exists()).toBe(false)
  })

  it('标题与副标题都渲染出来', () => {
    const wrapper = mount(DtCard, {
      props: { title: '我的权限', subtitle: '共 3 条' },
    })
    expect(wrapper.find('.dt-card__title').text()).toContain('我的权限')
    expect(wrapper.find('.dt-card__subtitle').text()).toBe('共 3 条')
  })

  it('actions 插槽渲染在标题区右侧', () => {
    const wrapper = mount(DtCard, {
      props: { title: '标题' },
      slots: { actions: '<button>改</button>' },
    })
    expect(wrapper.find('.dt-card__actions button').exists()).toBe(true)
  })

  it('corners 给的是四个角，不是两个', () => {
    const wrapper = mount(DtCard, { props: { corners: true } })
    expect(wrapper.findAll('.dt-card__corner')).toHaveLength(4)
  })

  it('角标对读屏隐藏——它是装饰', () => {
    const wrapper = mount(DtCard, { props: { corners: true } })
    expect(wrapper.find('.dt-card__corner').attributes('aria-hidden')).toBe(
      'true',
    )
  })

  it('默认不给角标：密集列表里逐张都点会太吵', () => {
    expect(mount(DtCard).find('.dt-card__corner').exists()).toBe(false)
  })

  it('footer 插槽渲染在正文之后', () => {
    const wrapper = mount(DtCard, { slots: { footer: '<span>脚注</span>' } })
    expect(wrapper.find('.dt-card__ft').text()).toBe('脚注')
  })

  it('没给 footer 插槽时不留一个空的页脚', () => {
    expect(mount(DtCard).find('.dt-card__ft').exists()).toBe(false)
  })

  it('内边距档位落到类名上', () => {
    const wrapper = mount(DtCard, { props: { padding: 'none' } })
    expect(wrapper.classes()).toContain('dt-card--pad-none')
  })
})
