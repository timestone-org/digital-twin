/**
 * @fileoverview 守设备状态徽标：每一档各有自己的修饰类与默认文案，
 * ⚠ `label` 传空串是「显示空文案」的受控用法，不许回落成状态名——
 * 回落会让「这一格故意留白」变成「这台设备在运行」。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import StatusBadge from '../../src/shared/StatusBadge.vue'
import { DEVICE_STATUSES, STATUS_LABEL } from '../../src/shared/status'

describe('设备状态徽标', () => {
  it('每一档都有自己的修饰类与默认文案', () => {
    for (const status of DEVICE_STATUSES) {
      const wrapper = mount(StatusBadge, { props: { status } })

      expect(wrapper.classes()).toContain(`dt-status-badge--${status}`)
      expect(wrapper.text()).toBe(STATUS_LABEL[status])
    }
  })

  it('无数据这一档说的是「无数据」', () => {
    const wrapper = mount(StatusBadge, { props: { status: 'unknown' } })

    expect(wrapper.text()).toBe('无数据')
  })

  it('传了 label 就用 label', () => {
    const wrapper = mount(StatusBadge, {
      props: { status: 'alarm', label: '超温停机' },
    })

    expect(wrapper.text()).toBe('超温停机')
    expect(wrapper.classes()).toContain('dt-status-badge--alarm')
  })

  it('label 传空串就是空文案，不回落成状态名', () => {
    const wrapper = mount(StatusBadge, {
      props: { status: 'running', label: '' },
    })

    expect(wrapper.get('.dt-status-badge__label').text()).toBe('')
    expect(wrapper.classes()).toContain('dt-status-badge--running')
  })

  it('圆点是纯装饰，读屏跳过', () => {
    const wrapper = mount(StatusBadge, { props: { status: 'running' } })

    expect(wrapper.get('.dt-status-badge__dot').attributes('aria-hidden')).toBe(
      'true',
    )
  })
})
