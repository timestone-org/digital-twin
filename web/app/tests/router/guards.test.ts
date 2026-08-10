/**
 * @fileoverview 路由守卫的判定契约：未登录跳登录、权限不足跳 403、
 * 令牌过期先换再放行，以及回跳地址的开放重定向防护。
 * ⚠ 未经判定的 returnUrl 是开放重定向：`//evil.example.com` 在浏览器里
 * 是一个协议相对的**外部**地址，看着却像站内路径。
 */
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NavigationGuard, Router } from 'vue-router'

import { installAuthGuard, safeReturnTarget } from '@/router/guards'
import { useAuthStore } from '@/stores/auth'

/** exp 落在 2001 年，前端只读 exp，签名无所谓。 */
const EXPIRED_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJleHAiOiAxMDAwMDAwMDAwfQ.sig'

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
      run: (to: Record<string, unknown>) =>
        guard?.(to as never, { fullPath: '/from' } as never, () => undefined),
    }
  }

  function signIn(codes: string[], token = 'header.payload.sig'): void {
    const auth = useAuthStore()
    auth.accessToken = token
    auth.user = { permissions: codes } as never
  }

  beforeEach(() => {
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.restoreAllMocks()
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
})
