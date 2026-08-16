/**
 * @fileoverview 勾选框的三态与可访问名称。
 *
 * ⚠ 半选只能用 DOM **属性**设，写成 HTML attribute 会被静默忽略——模板里看着
 * 完全正常，视觉与读屏却毫无反应。这条只有断言 `el.indeterminate` 才守得住：
 * 断言 `attributes('indeterminate')` 会在两种写法下都绿。
 */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import DtCheckbox from '../../src/components/DtCheckbox/DtCheckbox.vue'

describe('三态', () => {
  it('未勾时既不选中也不半选', () => {
    const el = mount(DtCheckbox, { props: { modelValue: false } }).find(
      'input',
    ).element
    expect([el.checked, el.indeterminate]).toEqual([false, false])
  })

  it('勾上时选中', () => {
    const wrapper = mount(DtCheckbox, { props: { modelValue: true } })
    expect(wrapper.find('input').element.checked).toBe(true)
  })

  it('⚠ 半选落在 DOM 属性上，不是 HTML attribute', () => {
    const wrapper = mount(DtCheckbox, {
      props: { modelValue: false, indeterminate: true },
    })
    expect(wrapper.find('input').element.indeterminate).toBe(true)
  })

  it('半选态跟着 prop 变', async () => {
    const wrapper = mount(DtCheckbox, {
      props: { modelValue: false, indeterminate: true },
    })
    await wrapper.setProps({ indeterminate: false })
    expect(wrapper.find('input').element.indeterminate).toBe(false)
  })
})

describe('可访问名称', () => {
  it('有可见 label 时渲染出来', () => {
    const wrapper = mount(DtCheckbox, {
      props: { modelValue: false, label: '归档' },
    })
    expect(wrapper.text()).toContain('归档')
  })

  it('⚠ ariaLabel 落在 input 上——挂到外层 label 上等于没给它名字', () => {
    const wrapper = mount(DtCheckbox, {
      props: { modelValue: false, ariaLabel: '全选这一层' },
    })
    expect(wrapper.find('input').attributes('aria-label')).toBe('全选这一层')
  })
})

describe('交互', () => {
  it('点一下抛出新的布尔值', async () => {
    const wrapper = mount(DtCheckbox, { props: { modelValue: false } })
    await wrapper.find('input').setValue(true)
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([true])
  })

  it('禁用时点不动', () => {
    const wrapper = mount(DtCheckbox, {
      props: { modelValue: false, disabled: true },
    })
    expect(wrapper.find('input').element.disabled).toBe(true)
  })

  it('⚠ 半选时点下去抛 true——半选不是第三种「值」，它只是显示态', async () => {
    const wrapper = mount(DtCheckbox, {
      props: { modelValue: false, indeterminate: true },
    })
    await wrapper.find('input').setValue(true)
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([true])
  })
})
