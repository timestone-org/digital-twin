/**
 * @fileoverview 展开态分组的开合契约：路由切进组内要自动摊开，
 * 手动摊开的组不因路由离开而被合上。
 */
import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'

import AppNavGroupTree from '@/components/layout/AppNavGroupTree.vue'
import type { NavItem } from '@/components/layout/navItems'

vi.mock('vue-router', () => ({
  RouterLink: {
    props: ['to'],
    template: '<a :href="to"><slot /></a>',
  },
}))

const SYSTEM: NavItem = {
  key: 'system',
  label: '系统管理',
  icon: 'settings',
  children: [
    { key: 'users', label: '用户管理', icon: 'users', to: '/system/users' },
  ],
}

function render(currentPath: string) {
  return mount(AppNavGroupTree, { props: { item: SYSTEM, currentPath } })
}

describe('AppNavGroupTree', () => {
  it('路由切进组内时自动摊开——否则跳进子页面后看不到自己在哪', async () => {
    const wrapper = render('/')
    expect(wrapper.find('a[href="/system/users"]').exists()).toBe(false)

    await wrapper.setProps({ currentPath: '/system/users' })
    expect(wrapper.find('a[href="/system/users"]').exists()).toBe(true)
  })

  it('路由离开组内时不强行合上，用户手动摊开的状态还在', async () => {
    const wrapper = render('/system/users')
    await wrapper.setProps({ currentPath: '/' })
    expect(wrapper.find('a[href="/system/users"]').exists()).toBe(true)
  })

  it('子项没有目标时退回工作台，而不是渲染一个死链接', async () => {
    const wrapper = mount(AppNavGroupTree, {
      props: {
        item: {
          key: 'x',
          label: '待接入',
          icon: 'settings',
          children: [{ key: 'y', label: '占位', icon: 'home' }],
        },
        currentPath: '/',
      },
    })
    await wrapper.get('[aria-controls="nav-group-x"]').trigger('click')
    expect(wrapper.get('#nav-group-x a').attributes('href')).toBe('/')
  })
})
