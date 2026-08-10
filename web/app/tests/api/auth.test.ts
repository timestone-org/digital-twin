/**
 * @fileoverview 锁住接口封装的路径、方法与匿名标记。
 * ⚠ 刷新与登出必须**匿名**发：走带令牌的路径会在 401 时递归触发刷新。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as authApi from '@/api/auth'
import * as client from '@/api/client'

let requestMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  requestMock = vi.fn().mockResolvedValue({})
  // ⚠ 两个入口都要打桩，只桩一个的话另一个会真的去发 fetch
  vi.spyOn(client, 'request').mockImplementation(requestMock)
  vi.spyOn(client, 'requestData').mockImplementation(requestMock)
})

afterEach(() => {
  vi.restoreAllMocks()
})

function lastCall(): [string, Record<string, unknown>] {
  const call = requestMock.mock.calls.at(-1)
  return [call?.[0] as string, (call?.[1] ?? {}) as Record<string, unknown>]
}

describe('会话接口', () => {
  it('登录打 POST /sessions 且匿名', async () => {
    await authApi.createSession('admin', 'pw')
    const [path, options] = lastCall()
    expect(path).toBe('/sessions')
    expect(options.method).toBe('POST')
    expect(options.anonymous).toBe(true)
    expect(options.body).toEqual({ username: 'admin', password: 'pw' })
  })

  it('刷新打动作端点且匿名', async () => {
    await authApi.refreshSession('r1')
    const [path, options] = lastCall()
    expect(path).toBe('/sessions:refresh')
    expect(options.anonymous).toBe(true)
    expect(options.body).toEqual({ refresh_token: 'r1' })
  })

  it('登出打吊销端点且匿名', async () => {
    await authApi.revokeSession('r1')
    const [path, options] = lastCall()
    expect(path).toBe('/sessions:revoke')
    expect(options.anonymous).toBe(true)
  })
})

describe('自服务接口', () => {
  it('取当前用户走 /users/me', async () => {
    await authApi.fetchMe()
    expect(lastCall()[0]).toBe('/users/me')
  })

  it('改资料用 PATCH，只带给出的字段', async () => {
    await authApi.updateMe({ full_name: '张三' })
    const [path, options] = lastCall()
    expect(path).toBe('/users/me')
    expect(options.method).toBe('PATCH')
    expect(options.body).toEqual({ full_name: '张三' })
  })

  it('改密码走动作端点并带旧密码', async () => {
    await authApi.changeMyPassword('old', 'new')
    const [path, options] = lastCall()
    expect(path).toBe('/users/me:change-password')
    expect(options.body).toEqual({
      current_password: 'old',
      new_password: 'new',
    })
  })

  it('权限目录走 /permissions', async () => {
    await authApi.fetchPermissionCatalog()
    expect(lastCall()[0]).toBe('/permissions')
  })
})
