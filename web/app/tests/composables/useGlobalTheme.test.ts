/**
 * @fileoverview 根注入的契约：变量写在文档根上（而不是某个容器里），
 * 换主题会重写，切回默认主题会清干净。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'

/** 挂一个只调用 useGlobalTheme 的空组件，拿到与顶栏共享的那份偏好句柄。 */
async function mountInjector() {
  vi.resetModules()
  const { useGlobalTheme } = await import('@/composables/useGlobalTheme')
  const { useThemePreference } =
    await import('@/composables/useThemePreference')
  const host = defineComponent({
    setup() {
      useGlobalTheme()
      return () => h('div')
    },
  })
  const wrapper = mount(host)
  return { wrapper, handle: useThemePreference() }
}

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false, addEventListener: () => undefined })),
  )
})

afterEach(() => {
  document.documentElement.removeAttribute('style')
  vi.unstubAllGlobals()
})

describe('useGlobalTheme', () => {
  it('默认主题不在根上留任何变量——它逐项等于 tokens.scss 的 :root', async () => {
    await mountInjector()
    expect(
      document.documentElement.style.getPropertyValue('--surface-base'),
    ).toBe('')
    expect(
      document.documentElement.style.getPropertyValue('--accent-primary'),
    ).toBe('')
  })

  it('选了主题就把整盘色写到文档根上，级联到不套壳的页面', async () => {
    const { handle } = await mountInjector()
    handle.setPreference('emerald')
    await Promise.resolve()

    expect(
      document.documentElement.style.getPropertyValue('--accent-primary'),
    ).toBe('#2ee6a6')
    expect(
      document.documentElement.style.getPropertyValue('--surface-base'),
    ).toBe('#03140f')
  })

  it('换一套主题会重写，不是叠加', async () => {
    const { handle } = await mountInjector()
    handle.setPreference('emerald')
    await Promise.resolve()
    handle.setPreference('lava-amber')
    await Promise.resolve()

    expect(
      document.documentElement.style.getPropertyValue('--accent-primary'),
    ).toBe('#ff8a3d')
  })

  it('切回默认深色会把变量清干净', async () => {
    const { DEFAULT_THEME_ID } = await import('@dt/tokens')
    const { handle } = await mountInjector()
    handle.setPreference('emerald')
    await Promise.resolve()
    handle.setPreference(DEFAULT_THEME_ID)
    await Promise.resolve()

    expect(
      document.documentElement.style.getPropertyValue('--accent-primary'),
    ).toBe('')
  })

  it('浅色主题下 color-scheme 跟着变——不然原生滚动条与下拉还是深色皮肤', async () => {
    const { handle } = await mountInjector()
    handle.setPreference('light')
    await Promise.resolve()

    expect(document.documentElement.style.colorScheme).toBe('light')
  })
})
