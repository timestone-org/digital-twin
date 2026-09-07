/**
 * @fileoverview HTTP 旧 401 与 API Key 嵌入会话切换的跨层竞态契约。
 */
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { STORAGE_KEYS } from '@dt/security'

import * as authApi from '@/api/auth'
import { BizError, request } from '@/api/client'
import { resetEmbedContext, useEmbedContext } from '@/features/embed/context'
import { setUnauthorizedRedirect, useAuthStore } from '@/stores/auth'

function session(access: string, refresh: string) {
  return {
    token: {
      access_token: access,
      refresh_token: refresh,
      token_type: 'bearer',
      expires_in_s: 900,
    },
    user: { id: 'u1', username: 'admin', permissions: [] } as never,
  }
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
  setActivePinia(createPinia())
  setUnauthorizedRedirect(() => undefined)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  resetEmbedContext()
  localStorage.clear()
})

describe('跨会话 401', () => {
  it('普通请求的旧 401 不能经登出钩子清掉新嵌入会话', async () => {
    vi.spyOn(authApi, 'createSession').mockResolvedValue(
      session('normal-a', 'r1'),
    )
    const oldRefresh = deferred<ReturnType<typeof session>>()
    const refresh = vi
      .spyOn(authApi, 'refreshSession')
      .mockImplementation(() => oldRefresh.promise)
    vi.spyOn(authApi, 'createSessionFromApiKey').mockResolvedValue({
      token: {
        access_token: 'embed-access',
        token_type: 'bearer',
        expires_in_s: 300,
      },
      user: { id: 'u1', username: 'embed', permissions: [] } as never,
    })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            code: 40102,
            message: '过期',
            data: null,
            trace_id: 'trace-old',
          }),
          { status: 401, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    )
    const auth = useAuthStore()
    await auth.login('admin', 'pw')

    const staleRequest = request('/x')
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
    await auth.startEmbedSession('dtk_prefix_secret', 'emerald')
    oldRefresh.resolve(session('stale-access', 'stale-refresh'))

    await expect(staleRequest).rejects.toBeInstanceOf(BizError)
    expect(auth.accessToken).toBe('embed-access')
    expect(useEmbedContext().error.value).toBeNull()
    expect(localStorage.getItem(STORAGE_KEYS.accessToken)).toBe('normal-a')
    expect(localStorage.getItem(STORAGE_KEYS.refreshToken)).toBe('r1')
  })
})
