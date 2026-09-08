/**
 * @fileoverview 单屏主题配置容错、独立宿主与编辑器草稿注入契约。
 */
import { applyTheme } from '@dt/tokens'
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick, provide, ref, shallowRef } from 'vue'

import {
  DASHBOARD_THEME_KEY,
  dashboardThemeId,
  useDashboardTheme,
} from '@/features/dashboard/useDashboardTheme'

afterEach(() => {
  document.documentElement.removeAttribute('style')
})

describe('单屏主题', () => {
  it.each([
    undefined,
    {},
    { __base: null },
    { __base: 1 },
    { __base: 'unknown' },
  ])('缺失或未登记的配置 %j 跟随系统', (themeJson) => {
    expect(dashboardThemeId(themeJson)).toBeNull()
  })

  it('读取已登记的主题 id', () => {
    expect(dashboardThemeId({ __base: 'emerald' })).toBe('emerald')
  })

  it('两个宿主可以独立换肤，清除后跟随系统，卸载时释放局部样式', async () => {
    applyTheme(document.documentElement, 'light')
    const globalStyle = document.documentElement.getAttribute('style')
    const theme = shallowRef<Record<string, unknown>>({ __base: 'dark-tech' })
    const Harness = defineComponent({
      setup() {
        const first = ref<HTMLElement | null>(null)
        const second = ref<HTMLElement | null>(null)
        useDashboardTheme(first, () => theme.value)
        useDashboardTheme(second, () => ({ __base: 'emerald' }))
        return () =>
          h('main', [h('div', { ref: first }), h('div', { ref: second })])
      },
    })
    const wrapper = mount(Harness, { attachTo: document.body })
    await nextTick()
    const [first, second] = wrapper.findAll('div').map((entry) => entry.element)
    expect(first?.style.colorScheme).toBe('dark')
    expect(first?.style.getPropertyValue('--accent-primary')).toBe('#00cefc')
    expect(second?.style.getPropertyValue('--accent-primary')).toBe('#2ee6a6')

    theme.value = { __base: 'light' }
    await nextTick()
    expect(first?.style.colorScheme).toBe('light')
    expect(second?.style.colorScheme).toBe('dark')
    expect(document.documentElement.getAttribute('style')).toBe(globalStyle)

    theme.value = {}
    await nextTick()
    expect(first?.style.getPropertyValue('--accent-primary')).toBe('')
    expect(first?.style.colorScheme).toBe('')
    expect(document.documentElement.getAttribute('style')).toBe(globalStyle)

    wrapper.unmount()
    expect(second?.style.getPropertyValue('--accent-primary')).toBe('')
  })

  it('编辑器画布与预览读取同一份已注入的主题草稿', async () => {
    const theme = shallowRef<Record<string, unknown>>({})
    const Canvas = defineComponent({
      setup() {
        const host = ref<HTMLElement | null>(null)
        useDashboardTheme(host)
        return () => h('div', { ref: host })
      },
    })
    const Editor = defineComponent({
      setup() {
        provide(DASHBOARD_THEME_KEY, () => theme.value)
        return () => h(Canvas)
      },
    })
    const wrapper = mount(Editor)
    await nextTick()
    expect(wrapper.attributes('style') ?? '').not.toContain('--accent-primary')
    theme.value = { __base: 'emerald' }
    await nextTick()
    expect(
      wrapper.get('div').element.style.getPropertyValue('--accent-primary'),
    ).toBe('#2ee6a6')
    wrapper.unmount()
  })
})
