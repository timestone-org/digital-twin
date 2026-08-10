/**
 * @fileoverview 外壳的布局契约：`<main>` 自己不滚（flex 列 + overflow-hidden，
 * 滚动交给页面里的 DtDataView），以及标题 / 返回入口 / 两个插槽的透传。
 *
 * ⚠ 主内容不许有「限宽居中」开关：一半页面限宽、一半铺满，切页时内容会左右跳。
 */
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'

import AppShell from '@/components/layout/AppShell.vue'
import { useAuthStore } from '@/stores/auth'

vi.mock('vue-router', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useRoute: () => ({ path: '/', query: {} }),
  RouterLink: {
    props: ['to'],
    template: '<a :href="to"><slot /></a>',
  },
}))

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  const auth = useAuthStore()
  auth.user = {
    username: 'admin',
    full_name: '管理员',
    role: { name: 'admin' },
    role_permissions: [],
    direct_permissions: [],
    permissions: [],
  } as never
  auth.accessToken = 'token'
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('AppShell', () => {
  it('main 是 flex 列且自己不滚——滚动归页面里的数据视图', () => {
    const classes = mount(AppShell).get('main').classes()
    expect(classes).toContain('flex')
    expect(classes).toContain('flex-col')
    expect(classes).toContain('min-h-0')
    expect(classes).toContain('overflow-hidden')
    expect(classes).not.toContain('overflow-y-auto')
  })

  it('默认插槽渲染在 main 里', () => {
    const wrapper = mount(AppShell, {
      slots: { default: '<p class="probe">页面内容</p>' },
    })
    expect(wrapper.get('main').find('.probe').exists()).toBe(true)
  })

  it('actions 槽穿到顶栏', () => {
    const wrapper = mount(AppShell, {
      slots: { actions: '<span class="probe">新建</span>' },
    })
    expect(wrapper.get('header').find('.probe').exists()).toBe(true)
  })

  it('标题与副标题穿到顶栏', () => {
    const wrapper = mount(AppShell, {
      props: { title: '用户管理', subtitle: '账号与角色' },
    })
    expect(wrapper.get('header').text()).toContain('用户管理')
    expect(wrapper.get('header').text()).toContain('账号与角色')
  })

  it('返回入口缺省不出现', () => {
    expect(mount(AppShell).get('header').find('a').exists()).toBe(false)
  })

  it('给了 backTo 才在顶栏出现返回入口，backLabel 一并透传', () => {
    const wrapper = mount(AppShell, {
      props: { backTo: '/system/users', backLabel: '返回用户列表' },
    })
    const back = wrapper.get('header').get('a')
    expect(back.attributes('href')).toBe('/system/users')
    expect(back.attributes('aria-label')).toBe('返回用户列表')
  })

  it('左侧导航常驻', () => {
    expect(mount(AppShell).find('aside').exists()).toBe(true)
  })
})
