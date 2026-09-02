/**
 * @fileoverview 等人去确认的那一屏。
 *
 * 守两条：用户码要**原样摆出来**（它要被人照着敲），以及卸载必须把倒计时的
 * 定时器清掉——不清的话，离开这一页之后它还在每秒写一个已经销毁的组件。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import type { AssistantDeviceLoginStart } from '@dt/contracts'

import DeviceCodeCard from '@/pages/System/Models/components/DeviceCodeCard.vue'

function pending(
  over: Partial<AssistantDeviceLoginStart> = {},
): AssistantDeviceLoginStart {
  return {
    ref: 'r1',
    user_code: 'ABCD-1234',
    verification_uri: 'https://example.test/activate',
    interval_s: 5,
    expires_in_s: 125,
    ...over,
  }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('设备码那一屏', () => {
  it('用户码与验证地址都摆出来', () => {
    const wrapper = mount(DeviceCodeCard, { props: { pending: pending() } })
    expect(wrapper.get('.device-code__code').text()).toBe('ABCD-1234')
    expect(wrapper.get('a').attributes('href')).toBe(
      'https://example.test/activate',
    )
  })

  it('外链带 noopener——不带的话新页拿得到我们的 window', () => {
    const wrapper = mount(DeviceCodeCard, { props: { pending: pending() } })
    expect(wrapper.get('a').attributes('rel')).toContain('noopener')
  })

  it('倒计时一秒一格，走到零就停住', async () => {
    const wrapper = mount(DeviceCodeCard, {
      props: { pending: pending({ expires_in_s: 62 }) },
    })
    expect(wrapper.text()).toContain('1:02')
    await vi.advanceTimersByTimeAsync(3_000)
    expect(wrapper.text()).toContain('0:59')
    await vi.advanceTimersByTimeAsync(120_000)
    expect(wrapper.text()).toContain('0:00')
  })

  it('换一次登录时倒计时跟着换，不停在上一次的秒数上', async () => {
    const wrapper = mount(DeviceCodeCard, {
      props: { pending: pending({ expires_in_s: 30 }) },
    })
    await wrapper.setProps({ pending: pending({ expires_in_s: 600 }) })
    expect(wrapper.text()).toContain('10:00')
  })

  it('取消把事交回给上面', async () => {
    const wrapper = mount(DeviceCodeCard, { props: { pending: pending() } })
    await wrapper.get('button').trigger('click')
    expect(wrapper.emitted('cancel')).toHaveLength(1)
  })

  it('卸载之后定时器不再走', () => {
    const spy = vi.spyOn(globalThis, 'clearInterval')
    const wrapper = mount(DeviceCodeCard, { props: { pending: pending() } })
    wrapper.unmount()
    expect(spy).toHaveBeenCalled()
  })
})
