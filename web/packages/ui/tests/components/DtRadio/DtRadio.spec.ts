/**
 * @fileoverview 单个 DtRadio 的选中语义与键盘契约。
 * ⚠ 它是 div 不是 input：role / aria-checked / tabindex 全靠手写，
 * 漏一个读屏就读不出这是单选项，或者整组 Tab 不进去。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import DtRadio from '../../../src/components/DtRadio/DtRadio.vue'

const base = { value: 'a', checked: false }

describe('DtRadio', () => {
  it('以 role=radio 承载语义', () => {
    const wrapper = mount(DtRadio, { props: base })
    expect(wrapper.attributes('role')).toBe('radio')
  })

  it.each([
    [true, 'true'],
    [false, 'false'],
  ])('checked=%s 时 aria-checked=%s', (checked, expected) => {
    const wrapper = mount(DtRadio, { props: { ...base, checked } })
    expect(wrapper.attributes('aria-checked')).toBe(expected)
  })

  it('点击 emit 自己的 value', async () => {
    const wrapper = mount(DtRadio, { props: base })
    await wrapper.trigger('click')
    expect(wrapper.emitted('select')).toEqual([['a']])
  })

  it.each(['space', 'enter'])('%s 键同样选中', async (key) => {
    const wrapper = mount(DtRadio, { props: base })
    await wrapper.trigger(`keydown.${key}`)
    expect(wrapper.emitted('select')).toEqual([['a']])
  })

  it('已选中的再点一次仍照实 emit，由组去判重', async () => {
    const wrapper = mount(DtRadio, { props: { ...base, checked: true } })
    await wrapper.trigger('click')
    expect(wrapper.emitted('select')).toEqual([['a']])
  })

  it('disabled 时点击与按键都不 emit', async () => {
    const wrapper = mount(DtRadio, { props: { ...base, disabled: true } })
    await wrapper.trigger('click')
    await wrapper.trigger('keydown.space')
    expect(wrapper.emitted('select')).toBeUndefined()
  })

  it('disabled 时退出 Tab 序并标 aria-disabled', () => {
    const wrapper = mount(DtRadio, {
      props: { ...base, disabled: true, tabindex: 0 },
    })
    expect(wrapper.attributes('tabindex')).toBe('-1')
    expect(wrapper.attributes('aria-disabled')).toBe('true')
  })

  it('可用时 tabindex 由组下发', () => {
    const wrapper = mount(DtRadio, { props: { ...base, tabindex: -1 } })
    expect(wrapper.attributes('tabindex')).toBe('-1')
  })

  it('label 渲染在圆点右侧', () => {
    const wrapper = mount(DtRadio, { props: { ...base, label: '按天' } })
    expect(wrapper.find('.dt-radio__label').text()).toBe('按天')
  })

  it('无 label 时不留空的文字节点', () => {
    const wrapper = mount(DtRadio, { props: base })
    expect(wrapper.find('.dt-radio__label').exists()).toBe(false)
  })

  it('圆点对读屏隐藏，名称由 label 给', () => {
    const wrapper = mount(DtRadio, { props: { ...base, label: '按天' } })
    expect(wrapper.find('.dt-radio__dot').attributes('aria-hidden')).toBe(
      'true',
    )
  })

  it.each(['sm', 'md', 'lg'] as const)('size=%s 落到档位类上', (size) => {
    const wrapper = mount(DtRadio, { props: { ...base, size } })
    expect(wrapper.classes()).toContain(`dt-radio--${size}`)
  })

  it('选中时加修饰类，供圆心撑开', () => {
    const wrapper = mount(DtRadio, { props: { ...base, checked: true } })
    expect(wrapper.classes()).toContain('dt-radio--checked')
  })

  it('根节点可编程聚焦，供组做方向键导航', () => {
    const wrapper = mount(DtRadio, { props: base, attachTo: document.body })
    const node = wrapper.get<HTMLDivElement>('div').element
    node.focus()
    expect(document.activeElement).toBe(node)
    wrapper.unmount()
  })
})
