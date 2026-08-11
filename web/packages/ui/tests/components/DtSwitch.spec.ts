/**
 * @fileoverview DtSwitch 的开关语义与禁用契约。
 * ⚠ role=switch 少了 aria-checked，读屏只知道这里有个开关、不知道它开着没有；
 * 而 disabled 只写 CSS 不写属性时，键盘仍然点得动。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { nextTick } from 'vue'

import DtSwitch from '../../src/components/DtSwitch/DtSwitch.vue'

describe('DtSwitch', () => {
  it('以 role=switch 承载语义', () => {
    const wrapper = mount(DtSwitch, { props: { modelValue: false } })
    expect(wrapper.find('button').attributes('role')).toBe('switch')
  })

  it.each([
    [true, 'true'],
    [false, 'false'],
  ])('modelValue=%s 时 aria-checked=%s', (modelValue, checked) => {
    const wrapper = mount(DtSwitch, { props: { modelValue } })
    expect(wrapper.find('button').attributes('aria-checked')).toBe(checked)
  })

  it('点击 emit 取反后的值', async () => {
    const wrapper = mount(DtSwitch, { props: { modelValue: false } })
    await wrapper.find('button').trigger('click')
    expect(wrapper.emitted('update:modelValue')).toEqual([[true]])
  })

  it('开着时点击 emit false', async () => {
    const wrapper = mount(DtSwitch, { props: { modelValue: true } })
    await wrapper.find('button').trigger('click')
    expect(wrapper.emitted('update:modelValue')).toEqual([[false]])
  })

  it('自己不持状态：父组件不回写就保持原样', async () => {
    const wrapper = mount(DtSwitch, { props: { modelValue: false } })
    await wrapper.find('button').trigger('click')
    expect(wrapper.find('button').attributes('aria-checked')).toBe('false')
  })

  it('disabled 时点击不 emit，且原生禁用', async () => {
    const wrapper = mount(DtSwitch, {
      props: { modelValue: false, disabled: true },
    })
    await wrapper.find('button').trigger('click')
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    expect(wrapper.find('button').attributes('disabled')).toBe('')
  })

  it('⚠ disabled 时程序派发的 click 也不 emit：原生 disabled 只挡用户点击', async () => {
    const wrapper = mount(DtSwitch, {
      props: { modelValue: false, disabled: true },
    })
    wrapper.find('button').element.dispatchEvent(new Event('click'))
    await nextTick()
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  it('label 渲染在轨道旁', () => {
    const wrapper = mount(DtSwitch, {
      props: { modelValue: false, label: '自动刷新' },
    })
    expect(wrapper.find('.dt-switch__label').text()).toBe('自动刷新')
  })

  it('无可见 label 时由 ariaLabel 命名', () => {
    const wrapper = mount(DtSwitch, {
      props: { modelValue: false, ariaLabel: '自动刷新' },
    })
    expect(wrapper.find('button').attributes('aria-label')).toBe('自动刷新')
  })

  it('打开时加 on 修饰类，供轨道点亮', () => {
    const wrapper = mount(DtSwitch, { props: { modelValue: true } })
    expect(wrapper.find('button').classes()).toContain('dt-switch--on')
  })

  it.each(['sm', 'md', 'lg'] as const)('size=%s 落到档位类上', (size) => {
    const wrapper = mount(DtSwitch, { props: { modelValue: false, size } })
    expect(wrapper.find('button').classes()).toContain(`dt-switch--${size}`)
  })

  it('缺省档位是 md', () => {
    const wrapper = mount(DtSwitch, { props: { modelValue: false } })
    expect(wrapper.find('button').classes()).toContain('dt-switch--md')
  })

  it('type=button：放进表单里不许提交', () => {
    const wrapper = mount(DtSwitch, { props: { modelValue: false } })
    expect(wrapper.find('button').attributes('type')).toBe('button')
  })

  it('轨道对读屏隐藏，名称由按钮本身给', () => {
    const wrapper = mount(DtSwitch, { props: { modelValue: false } })
    expect(wrapper.find('.dt-switch__track').attributes('aria-hidden')).toBe(
      'true',
    )
  })
})
