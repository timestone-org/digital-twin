/**
 * @fileoverview DtSpinner 的可访问性契约：视觉隐藏的标签必须仍在无障碍树上。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import DtSpinner from '../../src/components/DtSpinner/DtSpinner.vue'

describe('DtSpinner', () => {
  it('带 role=status，读屏能感知加载中', () => {
    expect(mount(DtSpinner).attributes('role')).toBe('status')
  })

  it('默认标签是「加载中」', () => {
    expect(mount(DtSpinner).text()).toBe('加载中')
  })

  it('label 可覆盖', () => {
    const wrapper = mount(DtSpinner, { props: { label: '正在登录' } })
    expect(wrapper.text()).toBe('正在登录')
  })

  it('size 落到内联尺寸上', () => {
    const wrapper = mount(DtSpinner, { props: { size: 32 } })
    expect(wrapper.find('.dt-spinner__ring').attributes('style')).toContain(
      '32px',
    )
  })

  // 标签用 clip-path 视觉隐藏而不是 display:none —— 后者会让它从无障碍树上消失
  it('转圈的环对读屏隐藏', () => {
    expect(
      mount(DtSpinner).find('.dt-spinner__ring').attributes('aria-hidden'),
    ).toBe('true')
  })
})
