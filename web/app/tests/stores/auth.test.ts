/**
 * @fileoverview 锁住登录态：持久化、single-flight 刷新、失败即清空、
 * 权限对齐失败不踢人，以及跨标签同步（别的标签换令牌/登出都要跟上）。
 */
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { STORAGE_KEYS } from '@dt/security'

import * as authApi from '@/api/auth'
import { REFRESH_SKEW_S } from '@/config/app'
import {
  activateEmbed,
  resetEmbedContext,
  useEmbedContext,
} from '@/features/embed/context'
import { setUnauthorizedRedirect, useAuthStore } from '@/stores/auth'

function session(access = 'a1', refresh = 'r1', permissions: string[] = []) {
  return {
    token: {
      access_token: access,
      refresh_token: refresh,
      token_type: 'bearer',
      expires_in_s: 900,
    },
    user: { id: 'u1', username: 'admin', permissions } as never,
  }
}

function embedSession(access = 'e1', permissions: string[] = []) {
  return {
    token: {
      access_token: access,
      token_type: 'bearer',
      expires_in_s: 300,
    },
    user: { id: 'u1', username: 'embed', permissions } as never,
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

/** 只带 exp 的假 JWT：前端只解 exp 排定时器，签名由服务端校验。 */
function jwt(expSeconds: number): string {
  const payload = btoa(JSON.stringify({ exp: expSeconds })).replace(/=+$/, '')
  return `header.${payload}.signature`
}

/** 模拟别的标签写完存储后浏览器派给本标签的事件。 */
function otherTabWrote(key: string | null): void {
  window.dispatchEvent(new StorageEvent('storage', { key }))
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
  resetEmbedContext()
})

describe('auth store', () => {
  it('初始为未登录', () => {
    const auth = useAuthStore()
    expect(auth.isAuthenticated).toBe(false)
    expect(auth.permissions.size).toBe(0)
  })

  it('登录后写入令牌与用户并持久化', async () => {
    vi.spyOn(authApi, 'createSession').mockResolvedValue(
      session('a1', 'r1', ['user:view']),
    )
    const auth = useAuthStore()
    await auth.login('admin', 'pw')
    expect(auth.isAuthenticated).toBe(true)
    expect(auth.permissions.has('user:view')).toBe(true)
    expect(localStorage.getItem(STORAGE_KEYS.accessToken)).toBe('a1')
    expect(localStorage.getItem(STORAGE_KEYS.refreshToken)).toBe('r1')
  })

  it('displayName 优先取姓名，缺省回落用户名', async () => {
    vi.spyOn(authApi, 'createSession').mockResolvedValue({
      ...session(),
      user: { username: 'admin', full_name: '张三', permissions: [] } as never,
    })
    const auth = useAuthStore()
    await auth.login('admin', 'pw')
    expect(auth.displayName).toBe('张三')
  })

  it('从 localStorage 恢复登录态', () => {
    localStorage.setItem(STORAGE_KEYS.accessToken, 'a1')
    localStorage.setItem(
      STORAGE_KEYS.user,
      JSON.stringify({ permissions: ['user:view'] }),
    )
    setActivePinia(createPinia())
    const auth = useAuthStore()
    expect(auth.isAuthenticated).toBe(true)
    expect(auth.permissions.has('user:view')).toBe(true)
  })

  it('损坏的持久化用户不至于让应用起不来', () => {
    localStorage.setItem(STORAGE_KEYS.user, '{not json')
    setActivePinia(createPinia())
    expect(useAuthStore().user).toBeNull()
  })

  it('刷新成功后换成新令牌', async () => {
    vi.spyOn(authApi, 'createSession').mockResolvedValue(session())
    vi.spyOn(authApi, 'refreshSession').mockResolvedValue(session('a2', 'r2'))
    const auth = useAuthStore()
    await auth.login('admin', 'pw')
    await expect(auth.refresh()).resolves.toBe(true)
    expect(auth.accessToken).toBe('a2')
    expect(auth.refreshToken).toBe('r2')
  })

  it('并发刷新只发一次请求（single-flight）', async () => {
    vi.spyOn(authApi, 'createSession').mockResolvedValue(session())
    const spy = vi
      .spyOn(authApi, 'refreshSession')
      .mockResolvedValue(session('a2', 'r2'))
    const auth = useAuthStore()
    await auth.login('admin', 'pw')
    await Promise.all([auth.refresh(), auth.refresh(), auth.refresh()])
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('刷新失败即清空登录态', async () => {
    vi.spyOn(authApi, 'createSession').mockResolvedValue(session())
    vi.spyOn(authApi, 'refreshSession').mockRejectedValue(new Error('gone'))
    const auth = useAuthStore()
    await auth.login('admin', 'pw')
    await expect(auth.refresh()).resolves.toBe(false)
    expect(auth.isAuthenticated).toBe(false)
    expect(localStorage.getItem(STORAGE_KEYS.accessToken)).toBeNull()
  })

  it('没有刷新令牌时不发请求', async () => {
    const spy = vi.spyOn(authApi, 'refreshSession')
    await expect(useAuthStore().refresh()).resolves.toBe(false)
    expect(spy).not.toHaveBeenCalled()
  })

  it('登出会清空本地并吊销刷新令牌', async () => {
    vi.spyOn(authApi, 'createSession').mockResolvedValue(session())
    const revoke = vi.spyOn(authApi, 'revokeSession').mockResolvedValue()
    const auth = useAuthStore()
    await auth.login('admin', 'pw')
    await auth.logout()
    expect(auth.isAuthenticated).toBe(false)
    expect(revoke).toHaveBeenCalledWith('r1')
  })

  it('服务端吊销失败不阻断登出', async () => {
    vi.spyOn(authApi, 'createSession').mockResolvedValue(session())
    vi.spyOn(authApi, 'revokeSession').mockRejectedValue(new Error('down'))
    const auth = useAuthStore()
    await auth.login('admin', 'pw')
    await expect(auth.logout()).resolves.toBeUndefined()
    expect(auth.isAuthenticated).toBe(false)
  })

  it('syncMe 拉到新权限就写回', async () => {
    vi.spyOn(authApi, 'createSession').mockResolvedValue(session())
    vi.spyOn(authApi, 'fetchMe').mockResolvedValue({
      permissions: ['role:manage'],
    } as never)
    const auth = useAuthStore()
    await auth.login('admin', 'pw')
    await auth.syncMe()
    expect(auth.permissions.has('role:manage')).toBe(true)
  })

  it('syncMe 失败一律吞掉，不清登录态', async () => {
    vi.spyOn(authApi, 'createSession').mockResolvedValue(
      session('a1', 'r1', ['user:view']),
    )
    vi.spyOn(authApi, 'fetchMe').mockRejectedValue(new Error('flaky'))
    const auth = useAuthStore()
    await auth.login('admin', 'pw')
    await auth.syncMe()
    expect(auth.isAuthenticated).toBe(true)
    expect(auth.permissions.has('user:view')).toBe(true)
  })

  it('未登录时 syncMe 不发请求', async () => {
    const spy = vi.spyOn(authApi, 'fetchMe')
    await useAuthStore().syncMe()
    expect(spy).not.toHaveBeenCalled()
  })

  it('can 是闸 3：按持有的码判定', async () => {
    vi.spyOn(authApi, 'createSession').mockResolvedValue(
      session('a1', 'r1', ['user:view']),
    )
    const auth = useAuthStore()
    await auth.login('admin', 'pw')
    expect(auth.can(['user:view'])).toBe(true)
    expect(auth.can(['role:manage'])).toBe(false)
    expect(auth.can(['user:view', 'role:manage'], 'any')).toBe(true)
  })
})

describe('auth store 跨标签同步', () => {
  it('别的标签换了令牌就跟着换', async () => {
    vi.spyOn(authApi, 'createSession').mockResolvedValue(session())
    const auth = useAuthStore()
    await auth.login('admin', 'pw')

    localStorage.setItem(STORAGE_KEYS.accessToken, 'a2')
    localStorage.setItem(STORAGE_KEYS.refreshToken, 'r2')
    localStorage.setItem(
      STORAGE_KEYS.user,
      JSON.stringify({ username: 'admin', permissions: ['user:view'] }),
    )
    otherTabWrote(STORAGE_KEYS.accessToken)

    expect(auth.accessToken).toBe('a2')
    expect(auth.refreshToken).toBe('r2')
    expect(auth.permissions.has('user:view')).toBe(true)
  })

  it('别的标签登出后跟着清空并跳登录', async () => {
    const redirect = vi.fn()
    setUnauthorizedRedirect(redirect)
    vi.spyOn(authApi, 'createSession').mockResolvedValue(session())
    const auth = useAuthStore()
    await auth.login('admin', 'pw')

    localStorage.clear()
    otherTabWrote(null)

    expect(auth.isAuthenticated).toBe(false)
    expect(auth.user).toBeNull()
    expect(redirect).toHaveBeenCalledTimes(1)
  })

  it('令牌没变但别的标签对齐过权限时跟着换一份', async () => {
    vi.spyOn(authApi, 'createSession').mockResolvedValue(
      session('a1', 'r1', ['user:view']),
    )
    const auth = useAuthStore()
    await auth.login('admin', 'pw')

    localStorage.setItem(
      STORAGE_KEYS.user,
      JSON.stringify({ username: 'admin', permissions: ['role:manage'] }),
    )
    otherTabWrote(STORAGE_KEYS.user)

    expect(auth.accessToken).toBe('a1')
    expect(auth.permissions.has('role:manage')).toBe(true)
    expect(auth.permissions.has('user:view')).toBe(false)
  })

  it('本来就没登录时，别的标签登出不跳登录页', () => {
    const redirect = vi.fn()
    setUnauthorizedRedirect(redirect)
    useAuthStore()
    otherTabWrote(STORAGE_KEYS.accessToken)
    expect(redirect).not.toHaveBeenCalled()
  })

  it('存储里已经是新令牌时不再发刷新请求', async () => {
    vi.spyOn(authApi, 'createSession').mockResolvedValue(session())
    const spy = vi.spyOn(authApi, 'refreshSession')
    const auth = useAuthStore()
    await auth.login('admin', 'pw')

    // 别的标签换完了，storage 事件还没送到（或压根没送到）
    localStorage.setItem(STORAGE_KEYS.accessToken, 'a9')
    localStorage.setItem(STORAGE_KEYS.refreshToken, 'r9')

    await expect(auth.refresh()).resolves.toBe(true)
    expect(spy).not.toHaveBeenCalled()
    expect(auth.accessToken).toBe('a9')
  })

  it('撞车被服务端拒掉，但别的标签已写回新令牌时不登出', async () => {
    vi.spyOn(authApi, 'createSession').mockResolvedValue(session())
    vi.spyOn(authApi, 'refreshSession').mockImplementation(() => {
      // 同一枚令牌被别的标签抢先换掉：服务端把这次当重放拒了
      localStorage.setItem(STORAGE_KEYS.accessToken, 'a9')
      localStorage.setItem(STORAGE_KEYS.refreshToken, 'r9')
      return Promise.reject(new Error('replayed'))
    })
    const auth = useAuthStore()
    await auth.login('admin', 'pw')

    await expect(auth.refresh()).resolves.toBe(true)
    expect(auth.accessToken).toBe('a9')
  })

  it('刷新失败且别的标签已登出时如实返回失败', async () => {
    vi.spyOn(authApi, 'createSession').mockResolvedValue(session())
    vi.spyOn(authApi, 'refreshSession').mockImplementation(() => {
      localStorage.clear()
      return Promise.reject(new Error('revoked'))
    })
    const auth = useAuthStore()
    await auth.login('admin', 'pw')

    await expect(auth.refresh()).resolves.toBe(false)
    expect(auth.isAuthenticated).toBe(false)
  })
})

describe('auth store 嵌入会话', () => {
  it('首航在创建 store 前标记后一个普通 storage 键都不读', () => {
    localStorage.setItem(STORAGE_KEYS.accessToken, 'normal-access')
    localStorage.setItem(STORAGE_KEYS.refreshToken, 'normal-refresh')
    localStorage.setItem(
      STORAGE_KEYS.user,
      JSON.stringify({ username: 'normal', permissions: ['user:view'] }),
    )
    activateEmbed('emerald')
    setActivePinia(createPinia())
    const read = vi.spyOn(Storage.prototype, 'getItem')

    const auth = useAuthStore()

    expect(read).not.toHaveBeenCalled()
    expect(auth.accessToken).toBeNull()
    expect(auth.user).toBeNull()
  })

  it('交换结果只写内存，不覆盖同源普通登录态', async () => {
    localStorage.setItem(STORAGE_KEYS.accessToken, 'normal-access')
    localStorage.setItem(STORAGE_KEYS.refreshToken, 'normal-refresh')
    localStorage.setItem(
      STORAGE_KEYS.user,
      JSON.stringify({ username: 'normal', permissions: ['user:view'] }),
    )
    activateEmbed('emerald')
    setActivePinia(createPinia())
    vi.spyOn(authApi, 'createSessionFromApiKey').mockResolvedValue(
      embedSession('embed-access', ['dashboard:view']),
    )

    const auth = useAuthStore()
    await expect(
      auth.startEmbedSession('dtk_prefix_secret', 'emerald'),
    ).resolves.toBe(true)

    expect(auth.accessToken).toBe('embed-access')
    expect(auth.permissions.has('dashboard:view')).toBe(true)
    expect(localStorage.getItem(STORAGE_KEYS.accessToken)).toBe('normal-access')
    expect(localStorage.getItem(STORAGE_KEYS.refreshToken)).toBe(
      'normal-refresh',
    )
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.user) ?? '{}')).toEqual(
      {
        username: 'normal',
        permissions: ['user:view'],
      },
    )
  })

  it('续租复用内存 API Key，并替换短期 access token', async () => {
    const exchange = vi
      .spyOn(authApi, 'createSessionFromApiKey')
      .mockResolvedValueOnce(embedSession('embed-a'))
      .mockResolvedValueOnce(embedSession('embed-b'))
    const auth = useAuthStore()
    await auth.startEmbedSession('dtk_prefix_secret', 'light')

    await expect(auth.refresh()).resolves.toBe(true)

    expect(exchange).toHaveBeenNthCalledWith(1, 'dtk_prefix_secret')
    expect(exchange).toHaveBeenNthCalledWith(2, 'dtk_prefix_secret')
    expect(auth.accessToken).toBe('embed-b')
  })

  it('嵌入续租仍按标签内 single-flight 合并并发', async () => {
    const next = deferred<ReturnType<typeof embedSession>>()
    const exchange = vi
      .spyOn(authApi, 'createSessionFromApiKey')
      .mockResolvedValueOnce(embedSession('embed-a'))
      .mockImplementationOnce(() => next.promise)
    const auth = useAuthStore()
    await auth.startEmbedSession('dtk_prefix_secret', 'light')

    const first = auth.refresh()
    const second = auth.refresh()
    next.resolve(embedSession('embed-b'))

    await expect(Promise.all([first, second])).resolves.toEqual([true, true])
    expect(exchange).toHaveBeenCalledTimes(2)
  })

  it('续租失败显示嵌入错误，不跳登录也不清普通 storage', async () => {
    localStorage.setItem(STORAGE_KEYS.accessToken, 'normal-access')
    localStorage.setItem(STORAGE_KEYS.refreshToken, 'normal-refresh')
    const redirect = vi.fn()
    setUnauthorizedRedirect(redirect)
    vi.spyOn(authApi, 'createSessionFromApiKey')
      .mockResolvedValueOnce(embedSession('embed-a'))
      .mockRejectedValueOnce(new Error('revoked'))
    const auth = useAuthStore()
    await auth.startEmbedSession('dtk_prefix_secret', 'light')

    await expect(auth.refresh()).resolves.toBe(false)

    expect(useEmbedContext().error.value).toContain('嵌入授权已失效')
    expect(redirect).not.toHaveBeenCalled()
    expect(localStorage.getItem(STORAGE_KEYS.accessToken)).toBe('normal-access')
    expect(localStorage.getItem(STORAGE_KEYS.refreshToken)).toBe(
      'normal-refresh',
    )
  })

  it('嵌入态 clear、logout、storage 与前台事件都不碰普通登录态', async () => {
    localStorage.setItem(STORAGE_KEYS.accessToken, 'normal-access')
    localStorage.setItem(STORAGE_KEYS.refreshToken, 'normal-refresh')
    vi.spyOn(authApi, 'createSessionFromApiKey').mockResolvedValue(
      embedSession('embed-access'),
    )
    const revoke = vi.spyOn(authApi, 'revokeSession')
    const auth = useAuthStore()
    await auth.startEmbedSession('dtk_prefix_secret', 'light')

    const read = vi.spyOn(Storage.prototype, 'getItem')
    otherTabWrote(STORAGE_KEYS.accessToken)
    document.dispatchEvent(new Event('visibilitychange'))
    expect(auth.accessToken).toBe('embed-access')
    expect(read).not.toHaveBeenCalled()

    auth.clear()
    expect(localStorage.getItem(STORAGE_KEYS.accessToken)).toBe('normal-access')
    await auth.startEmbedSession('dtk_prefix_secret', 'light')
    await auth.logout()

    expect(revoke).not.toHaveBeenCalled()
    expect(localStorage.getItem(STORAGE_KEYS.accessToken)).toBe('normal-access')
    expect(localStorage.getItem(STORAGE_KEYS.refreshToken)).toBe(
      'normal-refresh',
    )
  })

  it('普通刷新晚返回不能覆盖后来建立的嵌入身份', async () => {
    vi.spyOn(authApi, 'createSession').mockResolvedValue(
      session('normal-a', 'r1'),
    )
    const oldRefresh = deferred<ReturnType<typeof session>>()
    vi.spyOn(authApi, 'refreshSession').mockImplementation(
      () => oldRefresh.promise,
    )
    vi.spyOn(authApi, 'createSessionFromApiKey').mockResolvedValue(
      embedSession('embed-access'),
    )
    const auth = useAuthStore()
    await auth.login('admin', 'pw')

    const stale = auth.refresh()
    await auth.startEmbedSession('dtk_prefix_secret', 'emerald')
    oldRefresh.resolve(session('stale-access', 'stale-refresh'))
    await stale

    expect(auth.accessToken).toBe('embed-access')
    expect(localStorage.getItem(STORAGE_KEYS.accessToken)).toBe('normal-a')
    expect(localStorage.getItem(STORAGE_KEYS.refreshToken)).toBe('r1')
  })

  it('连续两个 token 首航乱序返回时只采用最新一次', async () => {
    const first = deferred<ReturnType<typeof embedSession>>()
    const second = deferred<ReturnType<typeof embedSession>>()
    vi.spyOn(authApi, 'createSessionFromApiKey').mockImplementation((key) =>
      key === 'dtk_first_secret' ? first.promise : second.promise,
    )
    const auth = useAuthStore()

    const stale = auth.startEmbedSession('dtk_first_secret', 'emerald')
    const latest = auth.startEmbedSession('dtk_second_secret', 'light')
    second.resolve(embedSession('latest-access'))
    await latest
    first.resolve(embedSession('stale-access'))
    await stale

    expect(auth.accessToken).toBe('latest-access')
    expect(useEmbedContext().themeId.value).toBe('light')
    expect(useEmbedContext().error.value).toBeNull()
  })

  it('嵌入态不调用 auth 管理面的 users/me 对齐权限', async () => {
    vi.spyOn(authApi, 'createSessionFromApiKey').mockResolvedValue(
      embedSession(),
    )
    const fetchMe = vi.spyOn(authApi, 'fetchMe')
    const auth = useAuthStore()
    await auth.startEmbedSession('dtk_prefix_secret', 'light')

    await auth.syncMe()

    expect(fetchMe).not.toHaveBeenCalled()
  })
})

describe('auth store 主动刷新的排期', () => {
  it('页面重载后为恢复出来的登录态重排主动刷新', async () => {
    vi.useFakeTimers()
    const expiry = Math.floor(Date.now() / 1000) + 600
    localStorage.setItem(STORAGE_KEYS.accessToken, jwt(expiry))
    localStorage.setItem(STORAGE_KEYS.refreshToken, 'r1')
    const spy = vi
      .spyOn(authApi, 'refreshSession')
      .mockResolvedValue(session('a2', 'r2'))

    setActivePinia(createPinia())
    const auth = useAuthStore()
    await vi.advanceTimersByTimeAsync((600 - REFRESH_SKEW_S) * 1000 + 10)

    expect(spy).toHaveBeenCalledTimes(1)
    expect(auth.accessToken).toBe('a2')
  })

  it('回到前台补一次被节流掉的到期判定', async () => {
    vi.useFakeTimers()
    localStorage.setItem(
      STORAGE_KEYS.accessToken,
      jwt(Math.floor(Date.now() / 1000) - 10),
    )
    localStorage.setItem(STORAGE_KEYS.refreshToken, 'r1')
    const spy = vi
      .spyOn(authApi, 'refreshSession')
      .mockResolvedValue(session('a2', 'r2'))

    setActivePinia(createPinia())
    const auth = useAuthStore()
    document.dispatchEvent(new Event('visibilitychange'))

    expect(spy).toHaveBeenCalledTimes(1)
    await vi.runAllTimersAsync()
    expect(auth.accessToken).toBe('a2')
  })

  it('令牌还早的时候回到前台不刷新', () => {
    vi.useFakeTimers()
    localStorage.setItem(
      STORAGE_KEYS.accessToken,
      jwt(Math.floor(Date.now() / 1000) + 3600),
    )
    localStorage.setItem(STORAGE_KEYS.refreshToken, 'r1')
    const spy = vi.spyOn(authApi, 'refreshSession')

    setActivePinia(createPinia())
    useAuthStore()
    document.dispatchEvent(new Event('visibilitychange'))

    expect(spy).not.toHaveBeenCalled()
  })
})
