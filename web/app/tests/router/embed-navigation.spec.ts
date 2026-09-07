/**
 * @fileoverview 真实 Vue Router 下的嵌入首航清密钥、换票阻塞与单次离页契约。
 */
import { createPinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import {
  createRouter,
  createWebHistory,
  onBeforeRouteLeave,
  RouterView,
} from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EmbedSessionResult } from '@dt/contracts'

import * as authApi from '@/api/auth'
import { resetEmbedContext } from '@/features/embed/context'
import { installAuthGuard } from '@/router/guards'
import { useAuthStore } from '@/stores/auth'

const SESSION: EmbedSessionResult = {
  token: {
    access_token: 'embed-access',
    token_type: 'bearer',
    expires_in_s: 300,
  },
  user: {
    id: 'u1',
    username: 'embed',
    email: 'embed@example.com',
    full_name: null,
    avatar_url: null,
    phone: null,
    is_active: true,
    last_login_at: null,
    created_at: '2026-09-07T00:00:00Z',
    updated_at: '2026-09-07T00:00:00Z',
    role: {
      id: 'r1',
      name: 'viewer',
      description: null,
      is_builtin: false,
    },
    role_permissions: ['dashboard:view'],
    direct_permissions: [],
    permissions: ['dashboard:view'],
  },
}

function deferred<T>() {
  let settle: ((value: T) => void) | null = null
  const promise = new Promise<T>((resolve) => {
    settle = resolve
  })
  return {
    promise,
    resolve(value: T): void {
      if (settle === null) throw new Error('deferred 尚未初始化')
      settle(value)
    },
  }
}

beforeEach(() => {
  resetEmbedContext()
  localStorage.clear()
  window.history.replaceState(null, '', '/')
})

afterEach(() => {
  vi.restoreAllMocks()
  resetEmbedContext()
  localStorage.clear()
  window.history.replaceState(null, '', '/')
})

describe('嵌入导航', () => {
  it('等换票时已清掉密钥，后续站内跳转只执行一次离页守卫', async () => {
    const exchange = deferred<EmbedSessionResult>()
    const exchangeCall = vi
      .spyOn(authApi, 'createSessionFromApiKey')
      .mockImplementation(() => exchange.promise)
    let leaveCount = 0
    const Source = defineComponent({
      setup() {
        onBeforeRouteLeave(() => {
          leaveCount += 1
          return true
        })
        return () => h('div', 'source-page')
      },
    })
    const Target = defineComponent({
      setup: () => () => h('div', 'target-page'),
    })
    window.history.replaceState(
      null,
      '',
      '/source?token=dtk_prefix_secret&theme=emerald&keep=1',
    )
    const pinia = createPinia()
    const router = createRouter({
      history: createWebHistory(),
      routes: [
        {
          path: '/source',
          component: Source,
          meta: { permissions: ['dashboard:view'] },
        },
        {
          path: '/target',
          component: Target,
          meta: { permissions: ['dashboard:view'] },
        },
      ],
    })
    installAuthGuard(router)
    const wrapper = mount(
      defineComponent({ setup: () => () => h(RouterView) }),
      { attachTo: document.body, global: { plugins: [pinia, router] } },
    )
    const ready = router.isReady()

    await vi.waitFor(() => expect(exchangeCall).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => {
      expect(window.location.search).not.toContain('token=')
      expect(new URLSearchParams(window.location.search).get('embed')).toBe('1')
    })
    expect(wrapper.text()).not.toContain('source-page')

    exchange.resolve(SESSION)
    await ready
    await vi.waitFor(() => expect(wrapper.text()).toContain('source-page'))

    let preservedState: boolean | null = null
    const replaceState = window.history.replaceState.bind(window.history)
    vi.spyOn(window.history, 'replaceState').mockImplementation(
      (data, title, url) => {
        const given: unknown = data
        const before: unknown = window.history.state
        if (String(url).includes('/target?')) {
          preservedState = JSON.stringify(given) === JSON.stringify(before)
        }
        replaceState(given, title, url)
      },
    )

    await router.push('/target?keep=2')

    const query = new URLSearchParams(window.location.search)
    expect(leaveCount).toBe(1)
    expect(router.currentRoute.value.fullPath).toBe('/target?keep=2')
    expect(query.get('keep')).toBe('2')
    expect(query.get('embed')).toBe('1')
    expect(query.get('theme')).toBe('emerald')
    expect(preservedState).toBe(true)

    useAuthStore(pinia).clear()
    wrapper.unmount()
  })
})
