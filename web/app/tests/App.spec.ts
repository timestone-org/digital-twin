/** @fileoverview 应用根在嵌入授权失败时必须用明确错误接管路由页面。 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import App from '@/App.vue'
import { useRealtimeSessionBinding } from '@/composables/useRealtimeChannel'
import {
  activateEmbed,
  resetEmbedContext,
  showEmbedError,
} from '@/features/embed/context'

vi.mock('@/composables/useRealtimeChannel', () => ({
  useRealtimeSessionBinding: vi.fn(),
}))

const global = {
  stubs: {
    RouterView: { template: '<div data-test="route-page">页面</div>' },
    WorkspaceView: { template: '<div data-test="route-page">页面</div>' },
    DtToastHost: true,
    DtConfirmHost: true,
    DtTipHost: true,
  },
}

beforeEach(() => {
  localStorage.clear()
  resetEmbedContext()
  setActivePinia(createPinia())
  vi.mocked(useRealtimeSessionBinding).mockClear()
})

afterEach(() => {
  resetEmbedContext()
  document.documentElement.removeAttribute('style')
})

describe('App', () => {
  it('普通状态渲染路由页面', () => {
    expect(
      mount(App, { global }).find('[data-test="route-page"]').exists(),
    ).toBe(true)
  })

  it('应用根把实时通道绑到登录态上', () => {
    mount(App, { global })

    expect(useRealtimeSessionBinding).toHaveBeenCalledOnce()
  })

  it('嵌入失败时隐藏路由页面并展示原因', () => {
    activateEmbed('emerald')
    showEmbedError('API Key 已失效')
    const wrapper = mount(App, { global })

    expect(wrapper.find('[data-test="route-page"]').exists()).toBe(false)
    expect(wrapper.get('[data-test="embed-error"]').text()).toContain(
      'API Key 已失效',
    )
  })
})
