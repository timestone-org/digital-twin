/** @fileoverview 时钟时区、响应更新与定时器释放。 */
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import Component from '../../../src/modules/clock/Component.vue'
import manifest from '../../../src/modules/clock/manifest'

afterEach(() => vi.useRealTimers())

describe('数字时钟', () => {
  it('清单按需加载真实渲染组件', async () => {
    expect((await manifest.component()).default).toBe(Component)
  })
  it('上海时间跨日并每秒推进，卸载清理定时器', async () => {
    vi.useFakeTimers()
    const clear = vi.spyOn(globalThis, 'clearInterval')
    vi.setSystemTime(new Date('2026-11-16T15:59:59Z'))
    const wrapper = mount(Component, { props: { config: {}, values: {} } })
    expect(wrapper.text()).toBe('2026-11-16 23:59:59')
    await vi.advanceTimersByTimeAsync(1000)
    expect(wrapper.text()).toBe('2026-11-17 00:00:00')
    wrapper.unmount()
    expect(clear).toHaveBeenCalledOnce()
    clear.mockRestore()
  })
  it('切换时区、日期与秒数配置立即生效', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-17T01:02:03Z'))
    const wrapper = mount(Component, {
      props: {
        config: {
          timezone: 'UTC',
          showDate: false,
          showSeconds: false,
          align: 'left',
          opacity: 0.5,
          fontSize: 24,
        },
        values: {},
      },
    })
    expect(wrapper.text()).toBe('01:02')
    expect(wrapper.attributes('style')).toContain('font-size: 24px')
    await wrapper.setProps({ config: { timezone: 'invalid' } })
    expect(wrapper.text()).toBe('2026-11-17 09:02:03')
    wrapper.unmount()
  })
})
