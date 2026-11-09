/**
 * @fileoverview 刷新令牌撞上网络抖动：保留登录态并短间隔重试，不把人静默踢下线。
 */
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { STORAGE_KEYS } from '@dt/security'

import * as authApi from '@/api/auth'
import { BizError, TransportError } from '@/api/client'
import { resetEmbedContext } from '@/features/embed/context'
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

beforeEach(() => {
  resetEmbedContext()
  localStorage.clear()
  setActivePinia(createPinia())
  setUnauthorizedRedirect(() => undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('auth store 刷新遇到传输错误', () => {
  it('保留登录态，稍后自动重试并换上新令牌', async () => {
    vi.useFakeTimers()
    vi.spyOn(authApi, 'createSession').mockResolvedValue(session('a1', 'r1'))
    const spy = vi
      .spyOn(authApi, 'refreshSession')
      .mockRejectedValueOnce(new TransportError(0, '无法连接服务器'))
      .mockResolvedValue(session('a2', 'r2'))
    const auth = useAuthStore()
    await auth.login('admin', 'pw')
    await expect(auth.refresh()).resolves.toBe(false)
    expect(auth.accessToken).toBe('a1')
    expect(localStorage.getItem(STORAGE_KEYS.refreshToken)).toBe('r1')
    await vi.advanceTimersByTimeAsync(5_000)
    expect(spy).toHaveBeenCalledTimes(2)
    expect(auth.accessToken).toBe('a2')
  })

  it('服务端明确拒绝仍然清空登录态', async () => {
    vi.spyOn(authApi, 'createSession').mockResolvedValue(session('a1', 'r1'))
    vi.spyOn(authApi, 'refreshSession').mockRejectedValue(
      new BizError(40101, '令牌失效', 401, 't'),
    )
    const auth = useAuthStore()
    await auth.login('admin', 'pw')
    await expect(auth.refresh()).resolves.toBe(false)
    expect(auth.isAuthenticated).toBe(false)
  })
})
