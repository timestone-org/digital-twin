/**
 * @fileoverview 左侧导航条的行为契约：两态（展开 / 折叠）各自的呈现与无障碍、
 * 形态的持久化、按权限收敛入口、当前路由高亮、登出。
 *
 * ⚠ 折叠态里飞出面板的显隐由 CSS 的 hover / focus-within 负责，script 只维护
 * aria-expanded 与 Esc——所以那几条断言的是 aria 与焦点，不是可见性。
 */
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'

import * as authApi from '@/api/auth'
import AppNavRail from '@/components/layout/AppNavRail.vue'
import { useAuthStore } from '@/stores/auth'

const replace = vi.fn()
let currentPath = '/system/users'

vi.mock('vue-router', () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
  useRoute: () => ({ path: currentPath, query: {} }),
  RouterLink: {
    props: ['to'],
    template: '<a :href="to"><slot /></a>',
  },
}))

const STORAGE_KEY = 'dt.sidebar.collapsed'

function signIn(codes: string[], fullName = '管理员'): void {
  const auth = useAuthStore()
  auth.user = {
    username: 'admin',
    full_name: fullName,
    role: { name: 'admin' },
    role_permissions: codes,
    direct_permissions: [],
    permissions: codes,
  } as never
  auth.accessToken = 'token'
}

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  currentPath = '/system/users'
  replace.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

/** 挂载并登录。`collapsed` 经存储预置——形态在 setup 时就读定了。 */
function render(codes: string[], collapsed = false) {
  localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0')
  signIn(codes)
  return mount(AppNavRail)
}

function toggleButton(wrapper: VueWrapper) {
  return wrapper.get('[aria-controls="app-nav"]')
}

function toggleGroup(wrapper: VueWrapper) {
  return wrapper.get('[aria-controls="nav-group-system"]')
}

/** ⚠ 顶部品牌链接也指向 '/'，不限定在 nav 里会先抓到它。 */
function homeLink(wrapper: VueWrapper) {
  return wrapper.get('#app-nav a[href="/"]')
}

describe('AppNavRail · 按权限收敛', () => {
  it('无任何权限时只剩工作台，不显示够不着的分组', () => {
    const wrapper = render([])
    expect(wrapper.text()).not.toContain('系统管理')
    expect(wrapper.find('[aria-label="返回工作台"]').exists()).toBe(true)
  })

  it('持 user:view 时出现系统管理分组', () => {
    expect(render(['user:view']).text()).toContain('系统管理')
  })

  it('分组里只列出持有权限的那几项', () => {
    const wrapper = render(['user:view'])
    expect(wrapper.find('a[href="/system/users"]').exists()).toBe(true)
    expect(wrapper.find('a[href="/system/route-rules"]').exists()).toBe(false)
  })

  it('折叠态下的收敛口径与展开态一致', () => {
    const wrapper = render(['user:view'], true)
    const links = wrapper.findAll('.nav-flyout a').map((node) => node.text())
    expect(links).toContain('用户管理')
    expect(links).not.toContain('路由规则')
  })
})

describe('AppNavRail · 展开态', () => {
  it('二级项就地展开成真实链接，而不是飞出面板', () => {
    const wrapper = render(['user:view'])
    expect(wrapper.find('.nav-flyout').exists()).toBe(false)
    expect(wrapper.get('a[href="/system/users"]').text()).toContain('用户管理')
  })

  it('一级项同时给出图标与文字', () => {
    const wrapper = render([])
    expect(homeLink(wrapper).text()).toContain('工作台')
    expect(homeLink(wrapper).find('svg').exists()).toBe(true)
  })

  it('当前路由落在组内时默认摊开——否则进这一页看不到自己在哪', () => {
    const wrapper = render(['user:view'])
    expect(toggleGroup(wrapper).attributes('aria-expanded')).toBe('true')
  })

  it('不含当前路由的分组默认收起，点开合按钮才摊开', async () => {
    currentPath = '/'
    const wrapper = render(['user:view'])
    expect(wrapper.find('a[href="/system/users"]').exists()).toBe(false)
    expect(toggleGroup(wrapper).attributes('aria-expanded')).toBe('false')

    await toggleGroup(wrapper).trigger('click')
    expect(wrapper.find('a[href="/system/users"]').exists()).toBe(true)
    expect(toggleGroup(wrapper).attributes('aria-expanded')).toBe('true')
  })

  it('摊开后可以再点回去', async () => {
    const wrapper = render(['user:view'])
    await toggleGroup(wrapper).trigger('click')
    expect(wrapper.find('a[href="/system/users"]').exists()).toBe(false)
  })

  // 每一页都各套一层 AppShell，切页即整条侧栏重挂
  it('切页重挂侧栏后，手动摊开的分组不合回去', async () => {
    currentPath = '/'
    const first = render(['user:view'])
    await toggleGroup(first).trigger('click')
    first.unmount()

    currentPath = '/assets'
    const second = render(['user:view'])
    expect(toggleGroup(second).attributes('aria-expanded')).toBe('true')
    expect(second.find('a[href="/system/users"]').exists()).toBe(true)
  })

  it('当前子项标成 aria-current="page"', () => {
    const wrapper = render(['user:view'])
    expect(
      wrapper.get('a[href="/system/users"]').attributes('aria-current'),
    ).toBe('page')
  })
})

describe('AppNavRail · 折叠态', () => {
  it('只剩图标，一级文字收掉', () => {
    const wrapper = render(['user:view'], true)
    expect(homeLink(wrapper).text()).toBe('')
    expect(wrapper.find('.nav-flyout').exists()).toBe(true)
  })

  it('指针移入时展开飞出面板', async () => {
    const wrapper = render(['user:view'], true)
    await wrapper.find('.nav-group').trigger('mouseenter')
    expect(wrapper.find('.nav-flyout').attributes('aria-hidden')).toBe('false')
    expect(wrapper.get('.nav-trigger button').attributes('aria-expanded')).toBe(
      'true',
    )
  })

  it('移出后收起', async () => {
    const wrapper = render(['user:view'], true)
    await wrapper.find('.nav-group').trigger('mouseenter')
    await wrapper.find('.nav-group').trigger('mouseleave')
    expect(wrapper.find('.nav-flyout').attributes('aria-hidden')).toBe('true')
  })

  it('键盘聚焦进来同样展开——只认 hover 的话键盘用户进不去', async () => {
    const wrapper = render(['user:view'], true)
    await wrapper.find('.nav-group').trigger('focusin')
    expect(wrapper.find('.nav-flyout').attributes('aria-hidden')).toBe('false')
    await wrapper.find('.nav-group').trigger('focusout')
    expect(wrapper.find('.nav-flyout').attributes('aria-hidden')).toBe('true')
  })

  it('Esc 收起面板，并把焦点还给分组按钮', async () => {
    localStorage.setItem(STORAGE_KEY, '1')
    signIn(['user:view'])
    const wrapper = mount(AppNavRail, { attachTo: document.body })
    await wrapper.find('.nav-group').trigger('mouseenter')
    await wrapper.find('.nav-group').trigger('keydown.esc')
    expect(wrapper.find('.nav-flyout').attributes('aria-hidden')).toBe('true')
    expect(document.activeElement?.getAttribute('aria-label')).toBe('系统管理')
    wrapper.unmount()
  })

  it('未展开时按 Esc 不做任何事', async () => {
    const wrapper = render(['user:view'], true)
    await wrapper.find('.nav-group').trigger('keydown.esc')
    expect(wrapper.find('.nav-flyout').attributes('aria-hidden')).toBe('true')
  })

  it('点分组按钮可以把已展开的面板压下去', async () => {
    const wrapper = render(['user:view'], true)
    await wrapper.find('.nav-group').trigger('mouseenter')
    await wrapper.find('.nav-trigger button').trigger('click')
    expect(wrapper.find('.nav-flyout').attributes('aria-hidden')).toBe('true')
  })

  it('当前路由所在的分组标成活跃', () => {
    const wrapper = render(['user:view'], true)
    expect(wrapper.find('[aria-current="page"]').exists()).toBe(true)
  })
})

describe('AppNavRail · 形态切换', () => {
  // 贴边的辅助控件，走最小的 xs 档；点击面由样式外扩到 24px
  it('折叠钮用 xs 档，不按正常按钮的分量做', () => {
    expect(toggleButton(render([])).classes()).toContain('dt-btn--xs')
  })

  it('折叠钮的可读名称与 aria-expanded 随形态走', async () => {
    const wrapper = render([])
    expect(toggleButton(wrapper).attributes('aria-label')).toBe('折叠侧栏')
    expect(toggleButton(wrapper).attributes('aria-expanded')).toBe('true')

    await toggleButton(wrapper).trigger('click')
    expect(toggleButton(wrapper).attributes('aria-label')).toBe('展开侧栏')
    expect(toggleButton(wrapper).attributes('aria-expanded')).toBe('false')
  })

  it('点一下就换形态：文字收掉、飞出面板接手', async () => {
    const wrapper = render(['user:view'])
    await toggleButton(wrapper).trigger('click')
    expect(wrapper.find('.nav-flyout').exists()).toBe(true)
    expect(homeLink(wrapper).text()).toBe('')
  })

  it('形态写回存储，下次进页面不弹回默认', async () => {
    const wrapper = render(['user:view'])
    await toggleButton(wrapper).trigger('click')
    expect(localStorage.getItem(STORAGE_KEY)).toBe('1')
    expect(mount(AppNavRail).find('.nav-flyout').exists()).toBe(true)
  })

  it('折叠钮用的图标名都已登记——未登记的名字只会静默不渲染', async () => {
    const { isIconName } = await import('@dt/ui')
    expect(
      ['chevron-up', 'chevron-down'].filter((name) => !isIconName(name)),
    ).toEqual([])
  })
})

describe('AppNavRail · 品牌与账号', () => {
  it('顶部是项目标志，点它回工作台', () => {
    const wrapper = render([])
    const brand = wrapper.get('[aria-label="返回工作台"]')
    expect(brand.attributes('href')).toBe('/')
    expect(brand.find('svg.app-logo').exists()).toBe(true)
  })

  it('折叠态下标志缩一档，给 60px 的条留出余量', () => {
    const collapsed = render([], true).get('svg.app-logo').attributes('width')
    const expanded = render([]).get('svg.app-logo').attributes('width')
    expect(Number(collapsed)).toBeLessThan(Number(expanded))
  })

  it('头像取显示名的首字，缺省是问号', () => {
    expect(render(['user:view']).text()).toContain('管')
    setActivePinia(createPinia())
    const auth = useAuthStore()
    auth.user = null
    expect(mount(AppNavRail).text()).toContain('?')
  })

  it('展开态里头像旁写出账号与角色', () => {
    expect(render([]).text()).toContain('管理员 · admin')
  })

  it('登出后跳登录页', async () => {
    vi.spyOn(authApi, 'revokeSession').mockResolvedValue()
    const wrapper = render(['user:view'])
    await wrapper.find('[aria-label="退出登录"]').trigger('click')
    await flushPromises()
    expect(replace).toHaveBeenCalledWith({ name: 'login' })
  })
})
