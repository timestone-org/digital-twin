/**
 * @fileoverview 页内分区页签条。
 *
 * ⚠ 抽出来是因为它漂过：系统管理用 RouterLink 页签、OPC UA 详情用
 * `DtSegmented`，同一套产品两种长相。这里守的是「两处共用同一份标记」，
 * 以及页签是**导航**——中键新开、复制链接都要照常可用，所以必须是 `<a>`。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, mount } from '@vue/test-utils'

import AppTabNav from '@/components/layout/AppTabNav.vue'
import type { AppTabItem } from '@/components/layout'

vi.mock('vue-router', () => ({
  useRoute: () => ({ path: '/system/users' }),
}))

const ITEMS: AppTabItem[] = [
  { key: 'users', label: '用户', icon: 'users', to: '/system/users' },
  { key: 'roles', label: '角色', icon: 'shield-check', to: '/system/roles' },
]

function nav(items: AppTabItem[] = ITEMS) {
  return mount(AppTabNav, {
    props: { items, label: '系统管理' },
    global: {
      // ⚠ RouterLink 是路由插件装的全局组件，不是从 vue-router import 进来的，
      // 所以 mock 那个模块不管用，得在这里替身
      stubs: {
        RouterLink: {
          props: ['to'],
          template: '<a :href="to"><slot /></a>',
        },
      },
    },
  })
}

enableAutoUnmount(afterEach)

describe('页签是导航', () => {
  it('⚠ 渲染成 `<a>` 而不是按钮：中键新开与复制链接都该照常可用', () => {
    const links = nav().findAll('a')
    expect(links).toHaveLength(2)
    expect(links[0]?.attributes('href')).toBe('/system/users')
  })

  it('整条页签有名字，读屏才分得清页面上的多个 nav', () => {
    expect(nav().find('nav').attributes('aria-label')).toBe('系统管理')
  })

  it('当前页签标 aria-current，别的不标', () => {
    const links = nav().findAll('a')
    expect(links[0]?.attributes('aria-current')).toBe('page')
    expect(links[1]?.attributes('aria-current')).toBeUndefined()
  })

  it('每个页签都带图标与文字', () => {
    const wrapper = nav()
    expect(wrapper.findAll('svg')).toHaveLength(2)
    expect(wrapper.text()).toContain('用户')
    expect(wrapper.text()).toContain('角色')
  })
})

describe('一个页签都没有时', () => {
  it('⚠ 整条不渲染——空的 nav 会在页面上留一条没来由的分隔线', () => {
    expect(nav([]).find('nav').exists()).toBe(false)
  })
})
