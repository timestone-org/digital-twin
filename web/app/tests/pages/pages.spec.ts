/**
 * @fileoverview 其余页面的渲染与关键交互契约：首页按权限显隐、个人资料的两个
 * 表单、403/404 的返回入口、登录页遥测面板的定时器清理。
 */
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

import * as authApi from '@/api/auth'
import { BizError } from '@/api/client'
import ForbiddenPage from '@/pages/Forbidden/index.vue'
import HomePage from '@/pages/Home/index.vue'
import LoginTelemetry from '@/pages/Login/components/LoginTelemetry.vue'
import NotFoundPage from '@/pages/NotFound/index.vue'
import ProfilePage from '@/pages/Profile/index.vue'
import { useAuthStore } from '@/stores/auth'

const replace = vi.fn()

// AppShell 里的 AppNavRail 要 RouterLink 与 route.path，缺一个就整页渲染不出来
vi.mock('vue-router', () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
  useRoute: () => ({ path: '/', query: {} }),
  RouterLink: { template: '<a><slot /></a>' },
}))

function signIn(permissions: string[], direct: string[] = []): void {
  const auth = useAuthStore()
  auth.user = {
    username: 'admin',
    full_name: '管理员',
    email: 'a@e.com',
    phone: '',
    is_active: true,
    last_login_at: '2026-08-10T09:30:00.000Z',
    created_at: '2026-08-01T00:00:00.000Z',
    role: { name: 'admin', description: '内置超管' },
    role_permissions: permissions,
    direct_permissions: direct,
    permissions: [...new Set([...permissions, ...direct])],
  } as never
  auth.accessToken = 'token'
}

beforeEach(() => {
  setActivePinia(createPinia())
  replace.mockReset()
  // 对齐接口返回的是完整用户，缺字段的假件会让渲染在真实不会发生的地方崩
  vi.spyOn(authApi, 'fetchMe').mockResolvedValue({
    username: 'admin',
    role: { name: 'admin' },
    role_permissions: [],
    direct_permissions: [],
    permissions: [],
  } as never)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('首页', () => {
  it('列出角色权限与直权', () => {
    signIn(['user:view', 'role:manage'])
    const wrapper = mount(HomePage)
    expect(wrapper.text()).toContain('user:view')
    expect(wrapper.text()).toContain('role:manage')
  })

  it('没有任何权限码时给出空态', () => {
    signIn([])
    expect(mount(HomePage).text()).toContain('当前账号没有任何权限码')
  })

  it('身份卡给出角色与启用状态', () => {
    signIn(['user:view'])
    const text = mount(HomePage).text()
    expect(text).toContain('管理员')
    expect(text).toContain('已启用')
  })

  it('三个计数把「来自角色」与「单独授予」分开', () => {
    signIn(['user:view', 'role:manage'], ['user:grant'])
    // 按可访问名称定位，不按 class——class 属于实现细节
    const counts = mount(HomePage).find('[aria-label="权限计数"]').findAll('dd')
    // 有效 3 / 角色 2 / 直权 1
    expect(counts.map((n) => n.text())).toEqual(['3', '2', '1'])
  })

  it('持 user:view 时快捷入口列出用户管理', () => {
    signIn(['user:view'])
    expect(mount(HomePage).text()).toContain('用户管理')
  })

  it('一个模块权限都没有时快捷入口给空态而不是空白', () => {
    signIn([])
    const text = mount(HomePage).text()
    expect(text).toContain('没有可进入的模块')
    expect(text).not.toContain('用户管理')
  })

  it('挂载时对齐一次权限', () => {
    signIn(['user:view'])
    mount(HomePage)
    expect(authApi.fetchMe).toHaveBeenCalledTimes(1)
  })

  it('退出入口在左侧导航条上，点了跳登录页', async () => {
    signIn(['user:view'])
    vi.spyOn(authApi, 'revokeSession').mockResolvedValue()
    const wrapper = mount(HomePage)
    // 按可访问名称定位，不按 class——class 属于实现细节，改样式不该让测试红
    await wrapper.find('[aria-label="退出登录"]').trigger('click')
    await flushPromises()
    expect(replace).toHaveBeenCalledWith({ name: 'login' })
  })
})

describe('个人资料页', () => {
  it('预填当前用户的资料', () => {
    signIn([])
    const inputs = mount(ProfilePage).findAll('input')
    expect(inputs[0]?.element.value).toBe('管理员')
    expect(inputs[1]?.element.value).toBe('a@e.com')
  })

  it('保存成功后给出反馈', async () => {
    signIn([])
    vi.spyOn(authApi, 'updateMe').mockResolvedValue({} as never)
    const wrapper = mount(ProfilePage)
    await wrapper.findAll('form')[0]?.trigger('submit')
    await flushPromises()
    expect(wrapper.text()).toContain('资料已保存')
  })

  it('邮箱冲突时给出可读文案', async () => {
    signIn([])
    vi.spyOn(authApi, 'updateMe').mockRejectedValue(
      new BizError(40004, '', 409, 't'),
    )
    const wrapper = mount(ProfilePage)
    await wrapper.findAll('form')[0]?.trigger('submit')
    await flushPromises()
    expect(wrapper.text()).toContain('该邮箱已被占用')
  })

  it('改密码成功后清空输入', async () => {
    signIn([])
    vi.spyOn(authApi, 'changeMyPassword').mockResolvedValue()
    const wrapper = mount(ProfilePage)
    const inputs = wrapper.findAll('input')
    await inputs[3]?.setValue('Old123456789')
    await inputs[4]?.setValue('New123456789')
    await wrapper.findAll('form')[1]?.trigger('submit')
    await flushPromises()
    expect(wrapper.text()).toContain('密码已修改')
    expect(wrapper.findAll('input')[3]?.element.value).toBe('')
  })

  it('旧密码不对时给出可读文案', async () => {
    signIn([])
    vi.spyOn(authApi, 'changeMyPassword').mockRejectedValue(
      new BizError(40101, '', 401, 't'),
    )
    const wrapper = mount(ProfilePage)
    await wrapper.findAll('form')[1]?.trigger('submit')
    await flushPromises()
    expect(wrapper.text()).toContain('当前密码不正确')
  })
})

describe('错误页', () => {
  it('403 说明原因并给返回入口', async () => {
    const wrapper = mount(ForbiddenPage)
    expect(wrapper.text()).toContain('没有该操作的权限')
    await wrapper.find('button').trigger('click')
    expect(replace).toHaveBeenCalledWith('/')
  })

  it('404 说明原因并给返回入口', async () => {
    const wrapper = mount(NotFoundPage)
    expect(wrapper.text()).toContain('页面不存在')
    await wrapper.find('button').trigger('click')
    expect(replace).toHaveBeenCalledWith('/')
  })
})

describe('登录页遥测面板', () => {
  it('渲染时钟与遥测读数', () => {
    const wrapper = mount(LoginTelemetry)
    expect(wrapper.text()).toContain('SYSTEM')
    // 首帧就要有值：只在 onMounted 里赋值的话时钟位置会空一帧
    expect(wrapper.find('.telemetry__clock-now').text()).not.toBe('')
  })

  it('卸载时清掉定时器——大屏一开几天，漏一个就持续累积', () => {
    vi.useFakeTimers()
    const clearSpy = vi.spyOn(globalThis, 'clearInterval')
    const wrapper = mount(LoginTelemetry)
    wrapper.unmount()
    expect(clearSpy).toHaveBeenCalled()
    vi.useRealTimers()
  })
})
