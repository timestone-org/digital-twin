/**
 * @fileoverview 路由守卫的判定契约：未登录跳登录、权限不足跳 403、
 * 令牌过期先换再放行，以及回跳地址的开放重定向防护。
 * ⚠ 未经判定的 returnUrl 是开放重定向：`//evil.example.com` 在浏览器里
 * 是一个协议相对的**外部**地址，看着却像站内路径。
 */
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NavigationGuard, Router } from 'vue-router'

import * as authApi from '@/api/auth'
import { resetEmbedContext, useEmbedContext } from '@/features/embed/context'
import { installAuthGuard, safeReturnTarget } from '@/router/guards'
import { useAuthStore } from '@/stores/auth'

/** exp 落在 2001 年，前端只读 exp，签名无所谓。 */
const EXPIRED_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJleHAiOiAxMDAwMDAwMDAwfQ.sig'

function embedSession(access = 'embed-access', permissions: string[] = []) {
  return {
    token: { access_token: access, token_type: 'bearer', expires_in_s: 300 },
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

describe('safeReturnTarget', () => {
  it('站内相对路径原样返回', () => {
    expect(safeReturnTarget('/profile')).toBe('/profile')
    expect(safeReturnTarget('/a/b?c=1')).toBe('/a/b?c=1')
  })

  it('协议相对的外部地址被拒', () => {
    expect(safeReturnTarget('//evil.example.com')).toBe('/')
  })

  it('绝对地址被拒', () => {
    expect(safeReturnTarget('https://evil.example.com')).toBe('/')
    expect(safeReturnTarget('javascript:alert(1)')).toBe('/')
  })

  it('缺省与非字符串回落首页', () => {
    expect(safeReturnTarget(undefined)).toBe('/')
    expect(safeReturnTarget('')).toBe('/')
    expect(safeReturnTarget(['/a', '/b'])).toBe('/')
    expect(safeReturnTarget(null)).toBe('/')
  })
})

describe('installAuthGuard 的判定', () => {
  /** 造一个只跑守卫的假 router：不引真实路由表，判定逻辑才是被测的唯一变量。 */
  function fakeRouter() {
    let guard: NavigationGuard | null = null
    const router = {
      currentRoute: { value: { fullPath: '/now' } },
      replace: vi.fn(),
      beforeEach: (fn: NavigationGuard) => {
        guard = fn
      },
      afterEach: vi.fn(),
    }
    installAuthGuard(router as unknown as Router)
    return {
      router,
      run: (to: Record<string, unknown>) => {
        const target = {
          path: '/x',
          fullPath: '/x',
          hash: '',
          query: {},
          meta: {},
          name: 'x',
          ...to,
        }
        return guard?.(
          target as never,
          { fullPath: '/from' } as never,
          () => undefined,
        )
      },
    }
  }

  function signIn(codes: string[], token = 'header.payload.sig'): void {
    const auth = useAuthStore()
    auth.accessToken = token
    auth.user = { permissions: codes } as never
  }

  beforeEach(() => {
    resetEmbedContext()
    localStorage.clear()
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.restoreAllMocks()
    resetEmbedContext()
  })

  it('匿名路由直接放行', async () => {
    const { run } = fakeRouter()
    await expect(
      run({ meta: { anonymous: true }, name: 'not-found' }),
    ).resolves.toBe(true)
  })

  it('未登录访问受管路由 → 跳登录页并带上回跳地址，且不去尝试换令牌', async () => {
    const refresh = vi.spyOn(useAuthStore(), 'refresh')
    const { run } = fakeRouter()
    await expect(run({ meta: {}, fullPath: '/system/users' })).resolves.toEqual(
      {
        name: 'login',
        query: { returnUrl: '/system/users' },
      },
    )
    // 从没登录过的人不该触发一次注定失败的刷新
    expect(refresh).not.toHaveBeenCalled()
  })

  it('已登录再去登录页 → 回落地页，而不是又看一遍登录页', async () => {
    signIn([])
    const { run } = fakeRouter()
    await expect(
      run({ meta: { anonymous: true }, name: 'login', query: {} }),
    ).resolves.toBe('/')
  })

  it('登录页的 returnUrl 走 safeReturnTarget，站外地址被拒', async () => {
    signIn([])
    const { run } = fakeRouter()
    await expect(
      run({
        meta: { anonymous: true },
        name: 'login',
        query: { returnUrl: 'https://evil.example.com' },
      }),
    ).resolves.toBe('/')
  })

  it('权限不足 → 403，而不是放进去再让后端拒', async () => {
    signIn(['user:view'])
    const { run } = fakeRouter()
    await expect(
      run({
        meta: { permissions: ['role:manage'] },
        fullPath: '/system/roles',
      }),
    ).resolves.toEqual({ name: 'forbidden' })
  })

  it('权限够 → 放行', async () => {
    signIn(['user:view'])
    const { run } = fakeRouter()
    await expect(
      run({ meta: { permissions: ['user:view'] }, fullPath: '/system/users' }),
    ).resolves.toBe(true)
  })

  it('多码默认按「全都要」判，any 模式才放宽', async () => {
    signIn(['user:view'])
    const { run } = fakeRouter()
    const codes = ['user:view', 'role:manage']
    await expect(
      run({ meta: { permissions: codes }, fullPath: '/x' }),
    ).resolves.toEqual({ name: 'forbidden' })
    await expect(
      run({
        meta: { permissions: codes, permissionMode: 'any' },
        fullPath: '/x',
      }),
    ).resolves.toBe(true)
  })

  it('令牌过期时先换一次，换到了就放行', async () => {
    signIn([], EXPIRED_TOKEN)
    const auth = useAuthStore()
    const refresh = vi.spyOn(auth, 'refresh').mockResolvedValue(true)
    const { run } = fakeRouter()
    await expect(run({ meta: {}, fullPath: '/x' })).resolves.toBe(true)
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('令牌过期且换不到 → 跳登录页', async () => {
    signIn([], EXPIRED_TOKEN)
    const auth = useAuthStore()
    vi.spyOn(auth, 'refresh').mockResolvedValue(false)
    const { run } = fakeRouter()
    await expect(run({ meta: {}, fullPath: '/x' })).resolves.toEqual({
      name: 'login',
      query: { returnUrl: '/x' },
    })
  })

  it('API Key 换票未完成时已经移除 token，第二航等它完成再放行', async () => {
    const result = deferred<ReturnType<typeof embedSession>>()
    const exchange = vi
      .spyOn(authApi, 'createSessionFromApiKey')
      .mockImplementation(() => result.promise)
    const { run } = fakeRouter()
    const route = {
      path: '/dashboards/d1',
      fullPath: '/dashboards/d1',
      name: 'dashboard-view',
      meta: { permissions: ['dashboard:view'] },
    }

    await expect(
      run({
        ...route,
        fullPath: '/dashboards/d1?token=secret&theme=emerald',
        query: { token: 'dtk_prefix_secret', theme: 'emerald', keep: 'yes' },
      }),
    ).resolves.toEqual({
      path: '/dashboards/d1',
      query: { theme: 'emerald', keep: 'yes', embed: '1' },
      hash: '',
      replace: true,
    })
    expect(exchange).toHaveBeenCalledWith('dtk_prefix_secret')
    expect(useAuthStore().accessToken).toBeNull()

    const continued = Promise.resolve(
      run({ ...route, query: { embed: '1', theme: 'emerald' } }),
    )
    const settled = vi.fn()
    void continued.then(settled)
    await Promise.resolve()
    expect(settled).not.toHaveBeenCalled()

    result.resolve(embedSession('embed-access', ['dashboard:view']))
    await expect(continued).resolves.toBe(true)
    expect(useAuthStore().accessToken).toBe('embed-access')
    expect(useEmbedContext().themeId.value).toBe('emerald')
  })

  it('交换后的第二次导航按嵌入用户权限放行', async () => {
    vi.spyOn(authApi, 'createSessionFromApiKey').mockResolvedValue(
      embedSession('embed-access', ['dashboard:view']),
    )
    const { run } = fakeRouter()
    const route = {
      path: '/dashboards/d1',
      fullPath: '/dashboards/d1',
      name: 'dashboard-view',
      meta: { permissions: ['dashboard:view'] },
    }
    await run({ ...route, query: { token: 'dtk_prefix_secret' } })

    await expect(run({ ...route, query: { embed: '1' } })).resolves.toBe(true)
  })

  it('嵌入态站内跳转直接放行，不启动第二次 Router 导航', async () => {
    vi.spyOn(authApi, 'createSessionFromApiKey').mockResolvedValue(
      embedSession('embed-access', ['dashboard:view']),
    )
    const { run } = fakeRouter()
    await run({
      path: '/dashboards/d1',
      name: 'dashboard-view',
      query: { token: 'dtk_prefix_secret', theme: 'light' },
      meta: { permissions: ['dashboard:view'] },
    })

    await expect(
      run({
        path: '/dashboards/d2',
        name: 'dashboard-view',
        query: {},
        meta: { permissions: ['dashboard:view'] },
      }),
    ).resolves.toBe(true)
  })

  it.each(['/profile', '/system/users'])(
    '%s 集中拒绝嵌入，且不拿 API Key 发交换请求',
    async (path) => {
      const exchange = vi.spyOn(authApi, 'createSessionFromApiKey')
      const { run } = fakeRouter()

      await expect(
        run({
          path,
          name: path === '/profile' ? 'profile' : 'system-users',
          query: { token: 'dtk_prefix_secret', theme: 'light' },
        }),
      ).resolves.toMatchObject({
        query: { embed: '1', theme: 'light' },
        replace: true,
      })
      expect(exchange).not.toHaveBeenCalled()
      expect(useEmbedContext().error.value).toContain('不支持嵌入')
    },
  )

  it('嵌入用户权限不足显示明确错误，不跳普通 403 页面', async () => {
    vi.spyOn(authApi, 'createSessionFromApiKey').mockResolvedValue(
      embedSession('embed-access', []),
    )
    const { run } = fakeRouter()
    const route = {
      path: '/assets',
      name: 'assets',
      meta: { permissions: ['asset:view'] },
    }
    await run({ ...route, query: { token: 'dtk_prefix_secret' } })

    await expect(run({ ...route, query: { embed: '1' } })).resolves.toBe(true)
    expect(useEmbedContext().error.value).toContain('没有访问此页面所需的权限')
  })

  it('只有 embed 标记而内存凭据已丢失时不回落同源普通登录态', async () => {
    localStorage.setItem('dt.auth.access_token', 'normal-access')
    localStorage.setItem(
      'dt.auth.user',
      JSON.stringify({ permissions: ['dashboard:view'] }),
    )
    const { run } = fakeRouter()

    await expect(
      run({
        path: '/dashboards/d1',
        name: 'dashboard-view',
        query: { embed: '1', theme: 'emerald' },
        meta: { permissions: ['dashboard:view'] },
      }),
    ).resolves.toBe(true)
    expect(useAuthStore().accessToken).toBeNull()
    expect(useEmbedContext().error.value).toContain('宿主页面重新加载')
  })

  it('伪造 query 或重复 token 不会绕过交换', async () => {
    const exchange = vi.spyOn(authApi, 'createSessionFromApiKey')
    const { run } = fakeRouter()

    await run({
      path: '/assets',
      name: 'assets',
      query: { token: ['dtk_one', 'dtk_two'], theme: 'not-a-theme' },
      meta: { permissions: ['asset:view'] },
    })

    expect(exchange).not.toHaveBeenCalled()
    expect(useEmbedContext().error.value).toContain('格式不正确')
    expect(useEmbedContext().themeId.value).toBe('dark-tech')
  })
})
