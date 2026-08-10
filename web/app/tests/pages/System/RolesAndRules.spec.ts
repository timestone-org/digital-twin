/**
 * @fileoverview 角色页与路由规则页的行为契约：内置对象的入口收敛、
 * 空码规则的文案、覆盖式保存。
 */
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import type { RoleSummary, RouteRule } from '@dt/contracts'
import { DtConfirmHost, DtToastHost, useConfirm, useToast } from '@dt/ui'

import * as admin from '@/api/admin'
import * as authApi from '@/api/auth'
import { __resetPermissionCatalog } from '@/features/permissions/usePermissionCatalog'
import RolesPage from '@/pages/System/Roles/index.vue'
import RouteRulesPage from '@/pages/System/RouteRules/index.vue'
import { useAuthStore } from '@/stores/auth'

vi.mock('vue-router', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useRoute: () => ({ path: '/system/roles', query: {} }),
  RouterLink: { template: '<a><slot /></a>' },
}))

function role(over: Partial<RoleSummary> = {}): RoleSummary {
  return {
    id: 'r1',
    name: 'viewer',
    description: '只读用户',
    is_builtin: true,
    created_at: '',
    updated_at: '',
    permissions: ['user:view'],
    user_count: 2,
    ...over,
  }
}

function rule(over: Partial<RouteRule> = {}): RouteRule {
  return {
    id: 'x1',
    path_pattern: '/api/v1/auth/sessions*',
    http_method: '*',
    permission_codes: [],
    match_mode: 'all',
    priority: 995,
    is_enabled: true,
    is_builtin: true,
    description: '登录/刷新/登出',
    created_at: '',
    updated_at: '',
    ...over,
  }
}

function signIn(codes: string[]): void {
  const auth = useAuthStore()
  auth.user = { permissions: codes, role: { name: 'admin' } } as never
  auth.accessToken = 'token'
}

beforeEach(() => {
  setActivePinia(createPinia())
})

// ⚠ 宿主 teleport 到 body，不自动卸载的话下一条用例会撞上已被摘掉的容器
enableAutoUnmount(afterEach)

beforeEach(() => {
  // 视图模式落在 localStorage 里，不清会跨用例串（角色页默认卡片、规则页默认表格）
  localStorage.clear()
  // ⚠ 权限目录必须打桩：不打的话弹窗一开就去发真实 fetch，
  // 测试进程里任何真实请求都是禁止的（testing-standard §6）。
  __resetPermissionCatalog()
  vi.spyOn(authApi, 'fetchPermissionCatalog').mockResolvedValue({
    items: [],
    groups: [],
  })
})

afterEach(() => {
  useToast().clear()
  useConfirm().resolve(false)
  vi.restoreAllMocks()
})

/** 挂上两个全局反馈宿主，走完「点删除 → 确认 → 真的删」这条完整路径。 */
function mountHosts(): void {
  mount(DtConfirmHost)
  mount(DtToastHost)
}

/** 角色页 + 指定的角色列表。 */
async function renderRoles(codes: string[], items: RoleSummary[]) {
  vi.spyOn(admin, 'listRoles').mockResolvedValue({
    items,
    page: 1,
    size: 100,
    total: items.length,
  })
  signIn(codes)
  const wrapper = mount(RolesPage)
  await flushPromises()
  return wrapper
}

/** 路由规则页 + 一条可删规则。 */
async function renderRules(codes: string[]) {
  vi.spyOn(admin, 'listRouteRules').mockResolvedValue({
    items: [rule({ is_builtin: false })],
    page: 1,
    size: 200,
    total: 1,
  })
  signIn(codes)
  const wrapper = mount(RouteRulesPage)
  await flushPromises()
  return wrapper
}

async function clickInConfirm(text: string): Promise<void> {
  const button = [...document.querySelectorAll('button')].find((node) =>
    node.textContent?.includes(text),
  )
  button?.click()
  await flushPromises()
}

describe('角色管理页', () => {
  beforeEach(() => {
    vi.spyOn(admin, 'listRoles').mockResolvedValue({
      items: [role(), role({ id: 'r2', name: 'ops', is_builtin: false })],
      page: 1,
      size: 100,
      total: 2,
    })
  })

  async function render(codes: string[]) {
    signIn(codes)
    const wrapper = mount(RolesPage)
    await flushPromises()
    return wrapper
  }

  it('列出角色与它持有的码', async () => {
    const wrapper = await render(['user:view'])
    expect(wrapper.text()).toContain('viewer')
    expect(wrapper.text()).toContain('user:view')
    expect(wrapper.text()).toContain('内置')
  })

  it('只读账号看不到写入口', async () => {
    const wrapper = await render(['user:view'])
    expect(wrapper.text()).not.toContain('新建角色')
  })

  it('内置角色不给删除与改权限的入口', async () => {
    const wrapper = await render(['user:view', 'role:manage'])
    // 两个角色里只有自建的那个有这两个按钮
    expect(wrapper.findAll('[aria-label="删除角色"]')).toHaveLength(1)
    expect(wrapper.findAll('[aria-label="设置权限"]')).toHaveLength(1)
  })

  it('内置角色仍可编辑（只为改描述）', async () => {
    const wrapper = await render(['user:view', 'role:manage'])
    expect(wrapper.findAll('[aria-label="编辑角色"]')).toHaveLength(2)
  })
})

describe('路由规则页', () => {
  beforeEach(() => {
    vi.spyOn(admin, 'listRouteRules').mockResolvedValue({
      items: [
        rule(),
        rule({ id: 'x2', permission_codes: ['user:view'], priority: 965 }),
      ],
      page: 1,
      size: 200,
      total: 2,
    })
  })

  async function render(codes: string[]) {
    signIn(codes)
    const wrapper = mount(RouteRulesPage)
    await flushPromises()
    return wrapper
  }

  it('空码规则显示成「任意登录用户」而不是留白', async () => {
    const wrapper = await render(['route_rule:view'])
    expect(wrapper.text()).toContain('任意登录用户')
  })

  it('列出优先级与路径模式', async () => {
    const wrapper = await render(['route_rule:view'])
    expect(wrapper.text()).toContain('995')
    expect(wrapper.text()).toContain('/api/v1/auth/sessions*')
  })

  it('只读账号看不到写入口', async () => {
    const wrapper = await render(['route_rule:view'])
    expect(wrapper.text()).not.toContain('新增规则')
    expect(wrapper.find('[aria-label="删除规则"]').exists()).toBe(false)
  })

  it('持 route_rule:manage 才出现写入口', async () => {
    const wrapper = await render(['route_rule:view', 'route_rule:manage'])
    expect(wrapper.text()).toContain('新增规则')
    expect(wrapper.findAll('[aria-label="删除规则"]')).toHaveLength(2)
  })

  it('停用规则会重新拉列表', async () => {
    const update = vi
      .spyOn(admin, 'updateRouteRule')
      .mockResolvedValue(rule({ is_enabled: false }))
    const wrapper = await render(['route_rule:view', 'route_rule:manage'])
    await wrapper.findAll('[aria-label="停用"]')[0]?.trigger('click')
    await flushPromises()
    expect(update).toHaveBeenCalledWith('x1', { is_enabled: false })
    expect(admin.listRouteRules).toHaveBeenCalledTimes(2)
  })
})

describe('危险操作的二次确认', () => {
  it('删角色要确认，且说清楚它下面还有多少账号', async () => {
    const remove = vi.spyOn(admin, 'deleteRole').mockResolvedValue()
    const wrapper = await renderRoles(
      ['role:manage'],
      [role({ is_builtin: false, user_count: 3 })],
    )
    mountHosts()
    await wrapper.find('[aria-label="删除角色"]').trigger('click')
    await flushPromises()
    expect(document.body.textContent).toContain('还有 3 个账号')
    await clickInConfirm('取消')
    expect(remove).not.toHaveBeenCalled()
  })

  it('确认后才真的删角色，并弹一条成功消息', async () => {
    const remove = vi.spyOn(admin, 'deleteRole').mockResolvedValue()
    const wrapper = await renderRoles(
      ['role:manage'],
      [role({ is_builtin: false })],
    )
    mountHosts()
    await wrapper.find('[aria-label="删除角色"]').trigger('click')
    await flushPromises()
    await clickInConfirm('删除')
    expect(remove).toHaveBeenCalledWith('r1')
    expect(document.body.textContent).toContain('角色已删除')
  })

  it('删规则的确认文案要点明它立刻改变全系统鉴权', async () => {
    const remove = vi.spyOn(admin, 'deleteRouteRule').mockResolvedValue()
    const wrapper = await renderRules(['route_rule:view', 'route_rule:manage'])
    mountHosts()
    await wrapper.find('[aria-label="删除规则"]').trigger('click')
    await flushPromises()
    expect(document.body.textContent).toContain('鉴权结果')
    await clickInConfirm('删除')
    expect(remove).toHaveBeenCalled()
  })
})

describe('角色管理页 · 交互', () => {
  async function open(codes: string[]) {
    const wrapper = await renderRoles(codes, [role({ is_builtin: false })])
    mountHosts()
    return wrapper
  }

  it('点新建打开空的角色表单', async () => {
    const wrapper = await open(['role:manage'])
    await wrapper
      .findAll('button')
      .filter((node) => node.text() === '新建角色')[0]
      ?.trigger('click')
    await flushPromises()
    expect(document.body.textContent).toContain('新建角色')
  })

  it('点编辑带出这一行的角色', async () => {
    const wrapper = await open(['role:manage'])
    await wrapper.find('[aria-label="编辑角色"]').trigger('click')
    await flushPromises()
    expect(document.body.textContent).toContain('编辑角色')
  })

  it('保存成功后关掉弹窗、刷新列表并弹消息', async () => {
    vi.spyOn(admin, 'updateRole').mockResolvedValue(role())
    const wrapper = await open(['role:manage'])
    await wrapper.find('[aria-label="编辑角色"]').trigger('click')
    await flushPromises()
    await clickInConfirm('保存')
    expect(admin.listRoles).toHaveBeenCalledTimes(2)
    expect(document.body.textContent).toContain('角色已更新')
  })

  it('设置权限的弹窗按行打开', async () => {
    const wrapper = await open(['role:manage'])
    await wrapper.find('[aria-label="设置权限"]').trigger('click')
    await flushPromises()
    expect(document.body.textContent).toContain('设置角色权限')
  })

  it('设置权限保存后落覆盖式写入', async () => {
    const save = vi.spyOn(admin, 'setRolePermissions').mockResolvedValue(role())
    const wrapper = await open(['role:manage'])
    await wrapper.find('[aria-label="设置权限"]').trigger('click')
    await flushPromises()
    await clickInConfirm('保存')
    expect(save).toHaveBeenCalledWith('r1', ['user:view'])
  })

  it('删除被后端拒绝时把原因弹出来', async () => {
    const { BizError } = await import('@/api/client')
    vi.spyOn(admin, 'deleteRole').mockRejectedValue(
      new BizError(40004, '角色下还有账号', 409, 't'),
    )
    const wrapper = await open(['role:manage'])
    await wrapper.find('[aria-label="删除角色"]').trigger('click')
    await flushPromises()
    await clickInConfirm('删除')
    expect(document.body.textContent).toContain('角色下还有账号')
  })

  it('可以切成表格视图', async () => {
    const wrapper = await open(['user:view'])
    await wrapper.find('[aria-label="表格视图"]').trigger('click')
    expect(wrapper.find('table').exists()).toBe(true)
  })

  it('取数失败后点重试会再拉一次', async () => {
    const { TransportError } = await import('@/api/client')
    vi.spyOn(admin, 'listRoles').mockRejectedValue(
      new TransportError(0, '无法连接服务器'),
    )
    signIn(['user:view'])
    const wrapper = mount(RolesPage)
    await flushPromises()
    await wrapper
      .findAll('button')
      .filter((node) => node.text() === '重试')[0]
      ?.trigger('click')
    await flushPromises()
    expect(admin.listRoles).toHaveBeenCalledTimes(2)
  })
})

describe('路由规则页 · 交互', () => {
  async function open(codes = ['route_rule:view', 'route_rule:manage']) {
    const wrapper = await renderRules(codes)
    mountHosts()
    return wrapper
  }

  it('点查询重新拉列表', async () => {
    const wrapper = await open()
    await wrapper
      .findAll('button')
      .filter((node) => node.text() === '查询')[0]
      ?.trigger('click')
    await flushPromises()
    expect(admin.listRouteRules).toHaveBeenCalledTimes(2)
  })

  it('搜索框回车即查询', async () => {
    const wrapper = await open()
    const search = wrapper.findAll('input')[0]
    await search?.setValue('sessions')
    await search?.trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(admin.listRouteRules).toHaveBeenLastCalledWith(
      expect.objectContaining({ q: 'sessions' }),
    )
  })

  it('停用按钮把 is_enabled 翻过来', async () => {
    const update = vi
      .spyOn(admin, 'updateRouteRule')
      .mockResolvedValue(rule({ is_enabled: false }))
    const wrapper = await open()
    await wrapper.find('[aria-label="停用"]').trigger('click')
    await flushPromises()
    expect(update).toHaveBeenCalledWith('x1', { is_enabled: false })
    expect(document.body.textContent).toContain('规则已停用')
  })

  it('启停失败时弹原因', async () => {
    const { BizError } = await import('@/api/client')
    vi.spyOn(admin, 'updateRouteRule').mockRejectedValue(
      new BizError(40110, '内置规则不可改', 403, 't'),
    )
    const wrapper = await open()
    await wrapper.find('[aria-label="停用"]').trigger('click')
    await flushPromises()
    expect(document.body.textContent).toContain('内置规则不可改')
  })

  it('点新增打开空表单，点编辑带出这一条', async () => {
    const wrapper = await open()
    await wrapper
      .findAll('button')
      .filter((node) => node.text() === '新增规则')[0]
      ?.trigger('click')
    await flushPromises()
    expect(document.body.textContent).toContain('新增规则')
    await clickInConfirm('取消')
    await wrapper.find('[aria-label="编辑规则"]').trigger('click')
    await flushPromises()
    expect(document.body.textContent).toContain('修改规则')
  })

  it('可以切成卡片视图', async () => {
    const wrapper = await open()
    await wrapper.find('[aria-label="卡片视图"]').trigger('click')
    expect(wrapper.find('table').exists()).toBe(false)
  })

  it('取数失败后点重试会再拉一次', async () => {
    const { TransportError } = await import('@/api/client')
    vi.spyOn(admin, 'listRouteRules').mockRejectedValue(
      new TransportError(0, '无法连接服务器'),
    )
    signIn(['route_rule:view'])
    const wrapper = mount(RouteRulesPage)
    await flushPromises()
    await wrapper
      .findAll('button')
      .filter((node) => node.text() === '重试')[0]
      ?.trigger('click')
    await flushPromises()
    expect(admin.listRouteRules).toHaveBeenCalledTimes(2)
  })
})
