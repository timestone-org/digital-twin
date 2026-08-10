/**
 * @fileoverview 锁住管理面接口的 URL 形状、方法与载荷。
 * ⚠ 动作端点的 `:verb` 写错不会有任何编译期报错，只会在运行时 404/405。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as admin from '@/api/admin'
import * as client from '@/api/client'

// ⚠ 两个入口都要打桩：取数走 requestData（必须有 data），
// 删除这类 204 的走 request。只桩一个的话另一个会真的去发 fetch。
let requestMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  requestMock = vi
    .fn()
    .mockResolvedValue({ items: [], page: 1, size: 20, total: 0 })
  vi.spyOn(client, 'request').mockImplementation(requestMock)
  vi.spyOn(client, 'requestData').mockImplementation(requestMock)
})

afterEach(() => {
  vi.restoreAllMocks()
})

function call(): [string, Record<string, unknown>] {
  const args = requestMock.mock.calls.at(-1)
  return [args?.[0] as string, (args?.[1] ?? {}) as Record<string, unknown>]
}

describe('用户接口', () => {
  it('列表带筛选与分页', async () => {
    await admin.listUsers({ q: 'a', size: 50, is_active: true })
    const [path, options] = call()
    expect(path).toBe('/users')
    expect(options.query).toEqual({ q: 'a', size: 50, is_active: true })
  })

  it('详情按 id 取', async () => {
    await admin.getUser('u1')
    expect(call()[0]).toBe('/users/u1')
  })

  it('建号用 POST /users', async () => {
    await admin.createUser({
      username: 'bob',
      email: 'b@e.com',
      password: 'Passw0rd12',
      role_id: 'r1',
    })
    const [path, options] = call()
    expect(path).toBe('/users')
    expect(options.method).toBe('POST')
  })

  it('改资料用 PATCH', async () => {
    await admin.updateUser('u1', { full_name: '张三' })
    const [path, options] = call()
    expect(path).toBe('/users/u1')
    expect(options.method).toBe('PATCH')
  })

  it('删除用 DELETE', async () => {
    await admin.deleteUser('u1')
    expect(call()[1].method).toBe('DELETE')
  })

  it.each([
    [true, '/users/u1:activate'],
    [false, '/users/u1:deactivate'],
  ])('启停走动作端点 %s', async (active, expected) => {
    await admin.setUserActive('u1', active)
    const [path, options] = call()
    expect(path).toBe(expected)
    expect(options.method).toBe('POST')
  })

  it('重置密码走动作端点', async () => {
    await admin.resetUserPassword('u1', 'New123456789')
    const [path, options] = call()
    expect(path).toBe('/users/u1:reset-password')
    expect(options.body).toEqual({ new_password: 'New123456789' })
  })

  it('改派角色走动作端点', async () => {
    await admin.assignRole('u1', 'r2')
    const [path, options] = call()
    expect(path).toBe('/users/u1:assign-role')
    expect(options.body).toEqual({ role_id: 'r2' })
  })

  it('写直权是 PUT 子资源（覆盖语义）', async () => {
    await admin.setDirectPermissions('u1', ['user:view'])
    const [path, options] = call()
    expect(path).toBe('/users/u1/permissions')
    expect(options.method).toBe('PUT')
    expect(options.body).toEqual({ codes: ['user:view'] })
  })
})

describe('角色接口', () => {
  it('列表', async () => {
    await admin.listRoles({ size: 100 })
    expect(call()[0]).toBe('/roles')
  })

  it('建角色', async () => {
    await admin.createRole({ name: 'ops', codes: [] })
    const [path, options] = call()
    expect(path).toBe('/roles')
    expect(options.method).toBe('POST')
  })

  it('改角色', async () => {
    await admin.updateRole('r1', { description: 'x' })
    expect(call()[1].method).toBe('PATCH')
  })

  it('设权限是 PUT 子资源', async () => {
    await admin.setRolePermissions('r1', ['user:view'])
    const [path, options] = call()
    expect(path).toBe('/roles/r1/permissions')
    expect(options.method).toBe('PUT')
  })

  it('删角色', async () => {
    await admin.deleteRole('r1')
    expect(call()[1].method).toBe('DELETE')
  })
})

describe('路由规则接口', () => {
  const payload = {
    path_pattern: '/api/v1/x',
    http_method: 'GET' as const,
    permission_codes: [],
    match_mode: 'all' as const,
    priority: 100,
    is_enabled: true,
  }

  it('列表带筛选', async () => {
    await admin.listRouteRules({ q: 'auth', is_enabled: true })
    const [path, options] = call()
    expect(path).toBe('/route-rules')
    expect(options.query).toEqual({ q: 'auth', is_enabled: true })
  })

  it('新增', async () => {
    await admin.createRouteRule(payload)
    const [path, options] = call()
    expect(path).toBe('/route-rules')
    expect(options.method).toBe('POST')
  })

  it('修改', async () => {
    await admin.updateRouteRule('x1', { is_enabled: false })
    const [path, options] = call()
    expect(path).toBe('/route-rules/x1')
    expect(options.method).toBe('PATCH')
  })

  it('删除', async () => {
    await admin.deleteRouteRule('x1')
    expect(call()[1].method).toBe('DELETE')
  })
})
