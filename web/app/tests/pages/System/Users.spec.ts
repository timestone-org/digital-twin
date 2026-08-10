/**
 * @fileoverview 用户管理页的行为契约：列表渲染、权限门禁、写操作后刷新、
 * 删除必须二次确认。
 */
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'

import { DtConfirmHost, DtToastHost, useConfirm, useToast } from '@dt/ui'

import * as admin from '@/api/admin'
import * as authApi from '@/api/auth'
import { __resetPermissionCatalog } from '@/features/permissions/usePermissionCatalog'
import UsersPage from '@/pages/System/Users/index.vue'
import { useAuthStore } from '@/stores/auth'

vi.mock('vue-router', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useRoute: () => ({ path: '/system/users', query: {} }),
  RouterLink: { template: '<a><slot /></a>' },
}))

/**
 * 列表项的假件。
 *
 * ⚠ 刻意**不带** role_permissions / direct_permissions / permissions：
 * `GET /users` 真的不返回它们。假件比真接口宽松，是这一页曾经整页崩掉却
 * 测试全绿的原因——凡是列表项都必须照这个形状造。
 */
function listItem(over: Record<string, unknown> = {}) {
  return {
    id: 'u1',
    username: 'alice',
    email: 'alice@example.com',
    full_name: '爱丽丝',
    avatar_url: null,
    phone: null,
    is_active: true,
    last_login_at: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    role: { id: 'r1', name: 'viewer', description: null, is_builtin: true },
    direct_permission_count: 0,
    ...over,
  } as never
}

/** 详情假件：只有详情端点才给三组权限码。 */
function user(over: Record<string, unknown> = {}) {
  return listItem({
    role_permissions: ['user:view'],
    direct_permissions: [],
    permissions: ['user:view'],
    ...over,
  })
}

function signIn(codes: string[]): void {
  const auth = useAuthStore()
  auth.user = user({ permissions: codes, role_permissions: codes })
  auth.accessToken = 'token'
}

beforeEach(() => {
  setActivePinia(createPinia())
  // ⚠ 视图模式落在 localStorage 里：不清的话「切成卡片视图」那条会把后面的
  // 排序用例带进卡片视图，表头一个都找不着，用例在随机序下必红
  localStorage.clear()
  // ⚠ 权限目录必须打桩：设置直权的弹窗会去 ensure()，不打桩就是真发 fetch
  __resetPermissionCatalog()
  vi.spyOn(authApi, 'fetchPermissionCatalog').mockResolvedValue({
    items: [],
    groups: [],
  })
  vi.spyOn(admin, 'listUsers').mockResolvedValue({
    items: [listItem()],
    page: 1,
    size: 50,
    total: 1,
  })
  vi.spyOn(admin, 'listRoles').mockResolvedValue({
    items: [],
    page: 1,
    size: 200,
    total: 0,
  })
})

// ⚠ 必须自动卸载：宿主是 teleport 到 body 的，上一条用例不卸载就直接清 body，
// 下一次更新会撞上已被摘掉的 teleport 容器（insertBefore of null）。
enableAutoUnmount(afterEach)

afterEach(() => {
  // 两个反馈模块都是模块级单例，不清会跨用例串
  useToast().clear()
  useConfirm().resolve(false)
  vi.restoreAllMocks()
})

async function render(codes: string[]) {
  signIn(codes)
  const wrapper = mount(UsersPage)
  await flushPromises()
  return wrapper
}

/** 页面 + 两个全局反馈宿主（真实挂在 App.vue 上），一起挂才能走完整条路径。 */
async function renderWithHosts(codes: string[]) {
  const wrapper = await render(codes)
  mount(DtConfirmHost)
  mount(DtToastHost)
  await flushPromises()
  return wrapper
}

/** 在第 n 个 DtSelect 里点一个选项。DtSelect 的浮层 teleport 在 body 上。 */
async function pickInSelect(
  wrapper: ReturnType<typeof mount>,
  index: number,
  label: string,
): Promise<void> {
  await wrapper.findAll('.dt-select__trigger')[index]?.trigger('click')
  await flushPromises()
  const option = [...document.querySelectorAll('.dt-select-menu__item')].find(
    (node) => node.textContent?.trim() === label,
  )
  option?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await flushPromises()
}

/** 点确认框里那个按钮。文案由调用方给，不同操作不一样。 */
async function clickInConfirm(text: string): Promise<void> {
  const button = [...document.querySelectorAll('button')].find((node) =>
    node.textContent?.includes(text),
  )
  button?.click()
  await flushPromises()
}

describe('用户管理页', () => {
  it('渲染用户行与角色标签', async () => {
    const wrapper = await render(['user:view'])
    expect(wrapper.text()).toContain('alice')
    expect(wrapper.text()).toContain('viewer')
  })

  it('直权列读条数——列表项没有权限码数组，读数组会整页崩', async () => {
    vi.spyOn(admin, 'listUsers').mockResolvedValue({
      items: [listItem({ direct_permission_count: 2 })],
      page: 1,
      size: 50,
      total: 1,
    })
    const wrapper = await render(['user:view'])
    expect(wrapper.text()).toContain('+2')
  })

  it('只读账号看不到任何写入口', async () => {
    const wrapper = await render(['user:view'])
    expect(wrapper.text()).not.toContain('新建用户')
    expect(wrapper.find('[aria-label="删除"]').exists()).toBe(false)
    expect(wrapper.find('[aria-label="改派角色"]').exists()).toBe(false)
  })

  it('持 user:manage 才出现新建与编辑', async () => {
    const wrapper = await render(['user:view', 'user:manage'])
    expect(wrapper.text()).toContain('新建用户')
    expect(wrapper.find('[aria-label="编辑资料"]').exists()).toBe(true)
  })

  it('持 user:grant 才出现授权入口', async () => {
    const wrapper = await render(['user:view', 'user:grant'])
    expect(wrapper.find('[aria-label="改派角色"]').exists()).toBe(true)
    expect(wrapper.find('[aria-label="设置直权"]').exists()).toBe(true)
  })

  it('停用后重新拉列表', async () => {
    const setActive = vi
      .spyOn(admin, 'setUserActive')
      .mockResolvedValue(user({ is_active: false }))
    const wrapper = await render(['user:view', 'user:manage'])
    await wrapper.find('[aria-label="停用"]').trigger('click')
    await flushPromises()
    expect(setActive).toHaveBeenCalledWith('u1', false)
    expect(admin.listUsers).toHaveBeenCalledTimes(2)
  })

  it('删除必须二次确认，且确认框说清楚会发生什么', async () => {
    const remove = vi.spyOn(admin, 'deleteUser').mockResolvedValue()
    const wrapper = await renderWithHosts(['user:view', 'user:delete'])
    await wrapper.find('[aria-label="删除"]').trigger('click')
    await flushPromises()
    expect(document.body.textContent).toContain('不可恢复')
    expect(remove).not.toHaveBeenCalled()
  })

  it('取消则不发请求', async () => {
    const remove = vi.spyOn(admin, 'deleteUser').mockResolvedValue()
    const wrapper = await renderWithHosts(['user:view', 'user:delete'])
    await wrapper.find('[aria-label="删除"]').trigger('click')
    await flushPromises()
    await clickInConfirm('取消')
    expect(remove).not.toHaveBeenCalled()
  })

  it('确认后才真的删', async () => {
    const remove = vi.spyOn(admin, 'deleteUser').mockResolvedValue()
    const wrapper = await renderWithHosts(['user:view', 'user:delete'])
    await wrapper.find('[aria-label="删除"]').trigger('click')
    await flushPromises()
    await clickInConfirm('删除')
    expect(remove).toHaveBeenCalledWith('u1')
  })

  it('写成功后弹一条消息', async () => {
    vi.spyOn(admin, 'setUserActive').mockResolvedValue(
      user({ is_active: false }),
    )
    const wrapper = await renderWithHosts(['user:view', 'user:manage'])
    await wrapper.find('[aria-label="停用"]').trigger('click')
    await flushPromises()
    expect(document.body.textContent).toContain('账号已停用')
  })

  it('后端拒绝时把原因显示出来，而不是静默失败', async () => {
    const { BizError } = await import('@/api/client')
    vi.spyOn(admin, 'setUserActive').mockRejectedValue(
      new BizError(40108, '目标账号的权限高于你，无法停用', 403, 't'),
    )
    const wrapper = await renderWithHosts(['user:view', 'user:manage'])
    await wrapper.find('[aria-label="停用"]').trigger('click')
    await flushPromises()
    expect(document.body.textContent).toContain('目标账号的权限高于你')
  })

  it('列表为空时给出空态', async () => {
    vi.spyOn(admin, 'listUsers').mockResolvedValue({
      items: [],
      page: 1,
      size: 50,
      total: 0,
    })
    const wrapper = await render(['user:view'])
    expect(wrapper.text()).toContain('暂无数据')
  })

  it('取数失败时给出错误态与重试入口', async () => {
    const { TransportError } = await import('@/api/client')
    vi.spyOn(admin, 'listUsers').mockRejectedValue(
      new TransportError(0, '无法连接服务器，请检查网络'),
    )
    const wrapper = await render(['user:view'])
    expect(wrapper.text()).toContain('加载失败')
    expect(wrapper.text()).toContain('重试')
  })
})

describe('用户管理页 · 取数与筛选', () => {
  it('点查询重新拉列表', async () => {
    const wrapper = await render(['user:view'])
    await wrapper
      .findAll('button')
      .filter((node) => node.text() === '查询')[0]
      ?.trigger('click')
    await flushPromises()
    expect(admin.listUsers).toHaveBeenCalledTimes(2)
  })

  it('搜索框回车即查询，不用再点一次按钮', async () => {
    const wrapper = await render(['user:view'])
    const search = wrapper.findAll('input')[0]
    await search?.setValue('alice')
    await search?.trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(admin.listUsers).toHaveBeenLastCalledWith(
      expect.objectContaining({ q: 'alice' }),
    )
  })

  it('清空搜索框时不下发空串——空串会被后端当成一个筛选条件', async () => {
    const wrapper = await render(['user:view'])
    const search = wrapper.findAll('input')[0]
    await search?.setValue('')
    await search?.trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(admin.listUsers).toHaveBeenLastCalledWith(
      expect.objectContaining({ q: undefined }),
    )
  })

  it('选状态筛选立刻重查，并把布尔值下发出去', async () => {
    const wrapper = await render(['user:view'])
    await pickInSelect(wrapper, 1, '已停用')
    expect(admin.listUsers).toHaveBeenLastCalledWith(
      expect.objectContaining({ is_active: false }),
    )
  })

  it('「全部状态」下发 undefined 而不是空串', async () => {
    const wrapper = await render(['user:view'])
    await pickInSelect(wrapper, 1, '已启用')
    await pickInSelect(wrapper, 1, '全部状态')
    expect(admin.listUsers).toHaveBeenLastCalledWith(
      expect.objectContaining({ is_active: undefined }),
    )
  })

  it('选角色筛选把 role_id 下发出去', async () => {
    vi.spyOn(admin, 'listRoles').mockResolvedValue({
      items: [
        {
          id: 'r9',
          name: 'ops',
          description: null,
          is_builtin: false,
          created_at: '',
          updated_at: '',
          permissions: [],
          user_count: 0,
        },
      ],
      page: 1,
      size: 200,
      total: 1,
    })
    const wrapper = await render(['user:view'])
    await pickInSelect(wrapper, 0, 'ops')
    expect(admin.listUsers).toHaveBeenLastCalledWith(
      expect.objectContaining({ role_id: 'r9' }),
    )
  })

  it('取数失败后点重试会再拉一次', async () => {
    const { TransportError } = await import('@/api/client')
    vi.spyOn(admin, 'listUsers').mockRejectedValue(
      new TransportError(0, '无法连接服务器'),
    )
    const wrapper = await render(['user:view'])
    await wrapper
      .findAll('button')
      .filter((node) => node.text() === '重试')[0]
      ?.trigger('click')
    await flushPromises()
    expect(admin.listUsers).toHaveBeenCalledTimes(2)
  })

  it('点表头排序把排序字段下发给后端，不是只排当前页', async () => {
    const wrapper = await render(['user:view'])
    async function clickSort(): Promise<void> {
      // 每次重新定位：重排后表头会重渲染，抓着旧引用点的是已卸载的节点
      await wrapper
        .findAll('th button')
        .filter((node) => node.text().includes('账号'))[0]
        ?.trigger('click')
      await flushPromises()
    }
    await clickSort()
    expect(admin.listUsers).toHaveBeenLastCalledWith(
      expect.objectContaining({ sort: 'username' }),
    )
    await clickSort()
    expect(admin.listUsers).toHaveBeenLastCalledWith(
      expect.objectContaining({ sort: '-username' }),
    )
  })

  it('切成卡片视图后同一批数据还在', async () => {
    const wrapper = await render(['user:view'])
    await wrapper.find('[aria-label="卡片视图"]').trigger('click')
    expect(wrapper.find('table').exists()).toBe(false)
    expect(wrapper.text()).toContain('alice')
  })
})

describe('用户管理页 · 弹窗联动', () => {
  it('点新建打开的是空表单', async () => {
    const wrapper = await render(['user:view', 'user:manage'])
    await wrapper
      .findAll('button')
      .filter((node) => node.text() === '新建用户')[0]
      ?.trigger('click')
    await flushPromises()
    expect(document.body.textContent).toContain('新建用户')
    const username = document.querySelectorAll('input')[0] as HTMLInputElement
    expect(username.value).toBe('')
  })

  it('点编辑带出这一行的资料', async () => {
    const wrapper = await render(['user:view', 'user:manage'])
    await wrapper.find('[aria-label="编辑资料"]').trigger('click')
    await flushPromises()
    expect(document.body.textContent).toContain('编辑资料')
    const values = [...document.querySelectorAll('input')].map(
      (node) => node.value,
    )
    expect(values).toContain('alice@example.com')
  })

  it('弹窗保存成功后关掉、刷新列表并弹消息', async () => {
    vi.spyOn(admin, 'updateUser').mockResolvedValue(user())
    const wrapper = await renderWithHosts(['user:view', 'user:manage'])
    await wrapper.find('[aria-label="编辑资料"]').trigger('click')
    await flushPromises()
    await clickInConfirm('保存')
    expect(admin.listUsers).toHaveBeenCalledTimes(2)
    expect(document.body.textContent).toContain('资料已更新')
  })

  it('改派角色的弹窗按行打开，取消后不再挂着', async () => {
    const wrapper = await render(['user:view', 'user:grant'])
    await wrapper.find('[aria-label="改派角色"]').trigger('click')
    await flushPromises()
    expect(document.body.textContent).toContain('改派角色')
    await clickInConfirm('取消')
    expect(document.body.textContent).not.toContain('改派角色')
  })

  it('重置密码的弹窗同样按行开合', async () => {
    const wrapper = await render(['user:view', 'user:manage'])
    await wrapper.find('[aria-label="重置密码"]').trigger('click')
    await flushPromises()
    expect(document.body.textContent).toContain('重置密码')
    await clickInConfirm('取消')
    expect(document.body.textContent).not.toContain('重置密码')
  })

  it('设置直权的弹窗按行打开', async () => {
    vi.spyOn(admin, 'getUser').mockResolvedValue(user())
    const wrapper = await render(['user:view', 'user:grant'])
    await wrapper.find('[aria-label="设置直权"]').trigger('click')
    await flushPromises()
    expect(document.body.textContent).toContain('设置直权')
  })
})
