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
import { activateEmbed, resetEmbedContext } from '@/features/embed/context'
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
  resetEmbedContext()
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
  resetEmbedContext()
})

describe('AppShell', () => {
  it('小视口使用可展开导航，扩大窗口后恢复桌面折叠偏好', async () => {
    const query = window.matchMedia('(max-width: 1023px)')
    const matches = vi.spyOn(query, 'matches', 'get').mockReturnValue(true)
    vi.spyOn(window, 'matchMedia').mockReturnValue(query)
    localStorage.setItem('dt.sidebar.collapsed', '1')
    const wrapper = mount(AppShell, { global: { stubs: { teleport: true } } })
    expect(wrapper.find('aside').exists()).toBe(false)
    await wrapper.get('[aria-label="打开主导航"]').trigger('click')
    expect(wrapper.get('[role="dialog"]').text()).toContain('工作台')
    expect(wrapper.find('.nav-toggle').exists()).toBe(false)
    await wrapper.get('[aria-label="关闭"]').trigger('click')
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)

    matches.mockReturnValue(false)
    query.dispatchEvent(new Event('change'))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[aria-label="打开主导航"]').exists()).toBe(false)
    expect(wrapper.get('aside').classes()).toContain('w-[60px]')
    expect(localStorage.getItem('dt.sidebar.collapsed')).toBe('1')
    wrapper.unmount()
  })

  it('小视口的嵌入和专注模式不显示主导航入口', () => {
    const query = window.matchMedia('(max-width: 1023px)')
    vi.spyOn(query, 'matches', 'get').mockReturnValue(true)
    vi.spyOn(window, 'matchMedia').mockReturnValue(query)
    const focused = mount(AppShell, { props: { focusMode: true } })
    expect(focused.find('[aria-label="打开主导航"]').exists()).toBe(false)
    focused.unmount()
    activateEmbed('emerald')
    const embedded = mount(AppShell)
    expect(embedded.find('[aria-label="打开主导航"]').exists()).toBe(false)
    embedded.unmount()
  })

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

  it('嵌入态隐藏全局导航，但保留页面自己的 sidebar 插槽', () => {
    activateEmbed('emerald')
    const wrapper = mount(AppShell, {
      slots: { sidebar: '<nav class="business-sidebar">项目栏</nav>' },
    })

    expect(wrapper.find('aside').exists()).toBe(false)
    expect(wrapper.find('.business-sidebar').exists()).toBe(true)
  })

  it('不填 sidebar 槽时不多出任何节点', () => {
    const wrapper = mount(AppShell, { attachTo: document.body })
    const root = document.querySelector('.dt-grid-bg')
    // 导航条 + 内容列，不多不少：空插槽不许留下一个占位节点，否则 flex 会多一格
    expect(root?.children).toHaveLength(2)
    wrapper.unmount()
  })

  it('sidebar 槽渲染在导航条与内容列之间', () => {
    const wrapper = mount(AppShell, {
      attachTo: document.body,
      slots: { sidebar: '<nav class="probe">项目栏</nav>' },
    })
    const root = document.querySelector('.dt-grid-bg')
    const children = root === null ? [] : [...root.children]
    const sidebar = document.querySelector('.probe')
    const main = document.querySelector('main')

    expect(children).toHaveLength(3)
    expect(sidebar === null ? -1 : children.indexOf(sidebar)).toBe(1)
    // 顶栏与主内容仍在最后那一列里，侧栏不许挤进那一列
    expect(main !== null && children[2]?.contains(main)).toBe(true)
    wrapper.unmount()
  })
})
it('专注配置只隐藏当前页面导航，退出后恢复', async () => {
  const wrapper = mount(AppShell, { props: { focusMode: true } })
  expect(wrapper.find('aside').exists()).toBe(false)
  expect(wrapper.get('main').classes()).toContain('p-2')
  await wrapper.setProps({ focusMode: false })
  expect(wrapper.find('aside').exists()).toBe(true)
  wrapper.unmount()
})
