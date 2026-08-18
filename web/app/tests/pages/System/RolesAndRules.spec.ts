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

describe('角色管理页 · 专属卡片', () => {
  /** 卡片视图是这一页的默认视图，卡片就是它的主界面。 */
  async function renderCards(
    codes: string[] = ['user:view', 'role:manage'],
    items: RoleSummary[] = [role()],
  ) {
    return await renderRoles(codes, items)
  }

  it('用的是角色专属卡，不是通用的字段表卡', async () => {
    const wrapper = await renderCards()
    expect(wrapper.find('.role-card').exists()).toBe(true)
    expect(wrapper.find('dl.dt-data-view__fields').exists()).toBe(false)
  })

  it('卡上四件事一次说清：角色名、内置标记、账号数与权限码摘要', async () => {
    const wrapper = await renderCards()
    const card = wrapper.find('.role-card')
    expect(card.text()).toContain('viewer')
    expect(card.text()).toContain('内置')
    expect(card.text()).toContain('账号数')
    expect(card.text()).toContain('2')
    expect(card.text()).toContain('共 1 个')
    expect(card.text()).toContain('user:view')
  })

  it('账号数为 0 写成「无账号」而不是留一个孤零零的 0', async () => {
    const wrapper = await renderCards(['user:view'], [role({ user_count: 0 })])
    expect(wrapper.find('.role-card').text()).toContain('无账号')
  })

  it('没有描述时副标识不消失，落成「未填写描述」', async () => {
    const wrapper = await renderCards(
      ['user:view'],
      [role({ description: null })],
    )
    expect(wrapper.find('.role-card').text()).toContain('未填写描述')
  })

  it('空码集在卡上是一条已知事实，不是占位符', async () => {
    const wrapper = await renderCards(
      ['user:view'],
      [role({ is_builtin: false, permissions: [] })],
    )
    const card = wrapper.find('.role-card')
    expect(card.text()).toContain('共 0 个')
    expect(card.text()).toContain('尚未配置权限码')
  })

  it('权限码按字典序排，两种视图顺序一致', async () => {
    const items = [role({ permissions: ['user:view', 'role:manage'] })]
    const wrapper = await renderCards(['user:view'], items)
    const inCard = wrapper.find('.code-chips').text()
    expect(inCard.indexOf('role:manage')).toBeLessThan(
      inCard.indexOf('user:view'),
    )
    await wrapper.find('[aria-label="表格视图"]').trigger('click')
    expect(wrapper.find('.code-chips').text()).toBe(inCard)
  })

  it('码多于 6 个时收成 +N，展开后一个都不少', async () => {
    const many = ['a:1', 'b:2', 'c:3', 'd:4', 'e:5', 'f:6', 'g:7', 'h:8']
    const wrapper = await renderCards(
      ['user:view'],
      [role({ permissions: many })],
    )
    const chips = wrapper.find('.code-chips')
    expect(chips.text()).toContain('+2')
    expect(wrapper.find('.role-card').text()).toContain('共 8 个')
    // <details> 里的剩余码本来就在 DOM 里，展开只是让它可见
    for (const code of many) expect(chips.text()).toContain(code)
    expect(chips.findAll('details')).toHaveLength(1)
  })

  it('内置角色的卡把「为什么改不了」写在找入口的地方', async () => {
    const wrapper = await renderCards()
    const card = wrapper.find('.role-card')
    expect(card.text()).toContain('内置角色不可修改')
    expect(card.find('[aria-label="查看权限"]').exists()).toBe(true)
    expect(card.find('[aria-label="以此为模板新建角色"]').exists()).toBe(true)
    expect(card.find('[aria-label="设置权限"]').exists()).toBe(false)
    expect(card.find('[aria-label="删除角色"]').exists()).toBe(false)
  })

  it('只读账号的卡上仍有权限入口，四颗写钮都不在', async () => {
    const wrapper = await renderCards(['user:view'])
    const card = wrapper.find('.role-card')
    expect(card.find('[aria-label="查看权限"]').exists()).toBe(true)
    expect(card.find('[aria-label="以此为模板新建角色"]').exists()).toBe(false)
    expect(card.find('[aria-label="编辑角色"]').exists()).toBe(false)
    expect(card.find('[aria-label="删除角色"]').exists()).toBe(false)
  })

  it('两种视图的入口逐个对应，不各写一套', async () => {
    const wrapper = await renderCards(
      ['user:view', 'role:manage'],
      [role(), role({ id: 'r2', name: 'ops', is_builtin: false })],
    )
    const inCards = wrapper.findAll('[aria-label="以此为模板新建角色"]').length
    expect(inCards).toBe(2)
    await wrapper.find('[aria-label="表格视图"]').trigger('click')
    expect(wrapper.findAll('[aria-label="以此为模板新建角色"]')).toHaveLength(
      inCards,
    )
  })
})

describe('角色授权的可达路径', () => {
  async function open(codes: string[], items: RoleSummary[] = [role()]) {
    const wrapper = await renderRoles(codes, items)
    mountHosts()
    return wrapper
  }

  it('内置角色点权限入口打开的是只读弹窗，且没有保存', async () => {
    const wrapper = await open(['user:view', 'role:manage'])
    await wrapper.find('[aria-label="查看权限"]').trigger('click')
    await flushPromises()
    expect(document.body.textContent).toContain('由系统种子维护')
    expect(document.body.textContent).toContain(
      '下一次服务启动的种子同步也会把它覆盖回',
    )
    const labels = [...document.querySelectorAll('button')].map((node) =>
      node.textContent?.trim(),
    )
    expect(labels).not.toContain('保存')
  })

  it('自定义角色 + role:manage 打开的仍是可写弹窗，保存落排序后的码', async () => {
    const save = vi.spyOn(admin, 'setRolePermissions').mockResolvedValue(role())
    const wrapper = await open(
      ['role:manage'],
      [
        role({
          id: 'r2',
          name: 'ops',
          is_builtin: false,
          permissions: ['user:view', 'role:manage'],
        }),
      ],
    )
    await wrapper.find('[aria-label="设置权限"]').trigger('click')
    await flushPromises()
    expect(document.body.textContent).toContain('设置角色权限')
    await clickInConfirm('保存')
    expect(save).toHaveBeenCalledWith('r2', ['role:manage', 'user:view'])
  })

  it('自定义角色但缺 role:manage 时，权限入口退成只读并说清缺什么', async () => {
    const wrapper = await open(
      ['user:view'],
      [role({ id: 'r2', name: 'ops', is_builtin: false })],
    )
    await wrapper.find('[aria-label="设置权限"]').trigger('click')
    await flushPromises()
    expect(document.body.textContent).toContain(
      '你没有「管理角色与角色权限」（role:manage）',
    )
  })

  it('内置角色一键克隆：名称带 _copy 后缀、码集原样预填、保存落创建', async () => {
    const create = vi
      .spyOn(admin, 'createRole')
      .mockResolvedValue(role({ id: 'r9', name: 'viewer_copy' }))
    const wrapper = await open(['role:manage'])
    await wrapper.find('[aria-label="以此为模板新建角色"]').trigger('click')
    await flushPromises()
    expect(document.body.textContent).toContain('新建角色')
    expect(document.body.textContent).toContain(
      '已预填 1 个来自「viewer」的权限码',
    )
    const name = document.querySelectorAll('input')[0] as HTMLInputElement
    expect(name.value).toBe('viewer_copy')
    await clickInConfirm('保存')
    expect(create).toHaveBeenCalledWith({
      name: 'viewer_copy',
      description: '只读用户',
      codes: ['user:view'],
    })
    expect(admin.listRoles).toHaveBeenCalledTimes(2)
  })

  it('只读弹窗里的克隆与行内克隆走同一条路，载荷一致', async () => {
    const create = vi.spyOn(admin, 'createRole').mockResolvedValue(role())
    const wrapper = await open(['role:manage'])

    await wrapper.find('[aria-label="以此为模板新建角色"]').trigger('click')
    await flushPromises()
    await clickInConfirm('保存')
    const fromRow = create.mock.calls[0]?.[0]
    expect(fromRow).toMatchObject({ name: 'viewer_copy', codes: ['user:view'] })

    create.mockClear()
    await wrapper.find('[aria-label="查看权限"]').trigger('click')
    await flushPromises()
    await clickInConfirm('以此为模板新建角色')
    await clickInConfirm('保存')
    expect(create.mock.calls[0]?.[0]).toEqual(fromRow)
  })

  it('克隆时已占用的名字会跳号，但那只是建议不是校验', async () => {
    const create = vi.spyOn(admin, 'createRole').mockResolvedValue(role())
    const wrapper = await open(
      ['role:manage'],
      [role(), role({ id: 'r2', name: 'viewer_copy', is_builtin: false })],
    )
    await wrapper
      .findAll('[aria-label="以此为模板新建角色"]')[0]
      ?.trigger('click')
    await flushPromises()
    await clickInConfirm('保存')
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'viewer_copy2' }),
    )
  })

  it('点编辑带出这一行的角色名——prop 改名写漏时只有这条会红', async () => {
    const wrapper = await open(
      ['role:manage'],
      [role({ is_builtin: false, name: 'ops' })],
    )
    await wrapper.find('[aria-label="编辑角色"]').trigger('click')
    await flushPromises()
    const name = document.querySelectorAll('input')[0] as HTMLInputElement
    expect(name.value).toBe('ops')
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

  it('「试一条路径」与主操作同处顶栏，不单占内容区一行', async () => {
    const wrapper = await render(['route_rule:view', 'route_rule:manage'])
    const header = wrapper.find('header')
    expect(header.text()).toContain('试一条路径')
    expect(header.text()).toContain('新增规则')
    // ⚠ 先断言存在：空 wrapper 的 text() 是空串，not.toContain 会白过
    const body = wrapper.find('main')
    expect(body.exists()).toBe(true)
    expect(body.text()).not.toContain('试一条路径')
  })

  it('试算不改数据，只读账号也有这个入口', async () => {
    const wrapper = await render(['route_rule:view'])
    expect(wrapper.find('header').text()).toContain('试一条路径')
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
    // 名下还有账号的角色根本不该问（见下面那一条），所以这里用一个空角色
    const wrapper = await renderRoles(
      ['role:manage'],
      [role({ is_builtin: false, user_count: 0 })],
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
  async function open(codes: string[], items?: RoleSummary[]) {
    const wrapper = await renderRoles(
      codes,
      items ?? [role({ is_builtin: false })],
    )
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

  // ⚠ 名下还有账号时删除必被拒：摆一个红色「删除」让人点，只换来一条报错，
  // 而他真正需要的是「先把账号改派走」
  it('名下还有账号时不弹确认，也不发请求', async () => {
    const remove = vi.spyOn(admin, 'deleteRole').mockResolvedValue()
    const wrapper = await open(
      ['role:manage'],
      [role({ is_builtin: false, user_count: 2 })],
    )

    await wrapper.find('[aria-label="删除角色"]').trigger('click')
    await flushPromises()

    expect(remove).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('先把它们改派到别的角色')
    expect(document.body.textContent).not.toContain('不可恢复')
  })

  it('删除被后端拒绝时把原因弹出来', async () => {
    // 前端拦不住的那类拒绝（并发改动、后端另有约束）仍要如实吐出来
    const { BizError } = await import('@/api/client')
    vi.spyOn(admin, 'deleteRole').mockRejectedValue(
      new BizError(40004, '角色仍被引用', 409, 't'),
    )
    const wrapper = await open(
      ['role:manage'],
      [role({ is_builtin: false, user_count: 0 })],
    )
    await wrapper.find('[aria-label="删除角色"]').trigger('click')
    await flushPromises()
    await clickInConfirm('删除')
    expect(document.body.textContent).toContain('角色仍被引用')
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

describe('路由规则页 · 判定链卡片', () => {
  const CHAIN: RouteRule[] = [
    rule({ id: 'x1', is_builtin: false }),
    rule({
      id: 'x2',
      is_builtin: false,
      is_enabled: false,
      permission_codes: ['user:view'],
      priority: 965,
    }),
  ]

  /** 规则页默认表格视图，卡片得自己切过去。 */
  async function renderCards(
    codes = ['route_rule:view', 'route_rule:manage'],
    total = CHAIN.length,
  ) {
    vi.spyOn(admin, 'listRouteRules').mockResolvedValue({
      items: CHAIN,
      page: 1,
      size: 20,
      total,
    })
    signIn(codes)
    const wrapper = mount(RouteRulesPage)
    await flushPromises()
    await wrapper.find('[aria-label="卡片视图"]').trigger('click')
    await flushPromises()
    return wrapper
  }

  it('每条规则一张专属卡，判定序写在卡上的 #n 里', async () => {
    const wrapper = await renderCards()
    const cards = wrapper.findAll('.rule-card')
    expect(cards).toHaveLength(CHAIN.length)
    expect(cards.map((card) => card.find('.rule-card__step').text())).toEqual([
      '#1',
      '#2',
    ])
  })

  // ⚠ 网格铺成多列之后，判定序不再由位置表达；#n 是它唯一的载体，丢了这一页就读不出结果
  it('卡片一行铺多张，所以顺序必须由 #n 兜住而不是靠位置', async () => {
    const wrapper = await renderCards()
    expect(wrapper.find('.dt-data-view__grid').classes()).toContain('is-cols-3')
    for (const card of wrapper.findAll('.rule-card')) {
      expect(card.find('.rule-card__step').exists()).toBe(true)
    }
  })

  it('顶部常驻说明把判定规则写出来，不靠视觉排布暗示', async () => {
    const wrapper = await renderCards(['route_rule:view'])
    expect(wrapper.text()).toContain('首条命中即终局')
    await wrapper.find('[aria-label="表格视图"]').trigger('click')
    expect(wrapper.text()).toContain('首条命中即终局')
  })

  it('停用的规则在卡上明说被跳过，不是只调淡', async () => {
    const wrapper = await renderCards()
    const off = wrapper.findAll('.rule-card')[1]
    expect(off?.classes()).toContain('rule-card--off')
    expect(off?.text()).toContain('不参与判定')
    expect(off?.text()).toContain('已停用')
    expect(off?.attributes('style')).toContain('--card-bg')
  })

  it('空码集在卡片视图里也写成「任意登录用户」', async () => {
    const wrapper = await renderCards(['route_rule:view'])
    expect(wrapper.findAll('.rule-card')[0]?.text()).toContain('任意登录用户')
  })

  it('两种视图的状态文案逐字相同', async () => {
    const wrapper = await renderCards()
    const card = wrapper.text()
    expect(card).toContain('已启用')
    expect(card).toContain('已停用')
    await wrapper.find('[aria-label="表格视图"]').trigger('click')
    const table = wrapper.text()
    expect(table).toContain('已启用')
    expect(table).toContain('已停用')
  })

  it('卡片视图里的停用按钮照样落写入', async () => {
    const update = vi
      .spyOn(admin, 'updateRouteRule')
      .mockResolvedValue(rule({ is_enabled: false }))
    const wrapper = await renderCards()
    await wrapper.find('.rule-card [aria-label="停用"]').trigger('click')
    await flushPromises()
    expect(update).toHaveBeenCalledWith('x1', { is_enabled: false })
  })

  it('判定序跨页连续：第二页首张卡是第 21 个被检查', async () => {
    const wrapper = await renderCards(['route_rule:view'], 40)
    await wrapper
      .findAll('button')
      .filter((node) => node.text() === '下一页')[0]
      ?.trigger('click')
    await flushPromises()
    expect(wrapper.find('.rule-card__step').text()).toBe('#21')
  })
})
