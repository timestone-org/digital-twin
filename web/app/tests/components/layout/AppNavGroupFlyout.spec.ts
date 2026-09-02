/**
 * @fileoverview 折叠态分组的触发键契约：组内路由 = DtButton 按压态，
 * 飞出面板的显隐与 aria-hidden 同源，当前子页标 aria-current="page"。
 */
import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'

import AppNavGroupFlyout from '@/components/layout/AppNavGroupFlyout.vue'
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
  return mount(AppNavGroupFlyout, { props: { item: SYSTEM, currentPath } })
}

describe('AppNavGroupFlyout', () => {
  it('路由在组内时图标键是按压态，离开后弹起', async () => {
    const wrapper = render('/system/users')
    const trigger = wrapper.get('button[aria-label="系统管理"]')
    expect(trigger.attributes('aria-pressed')).toBe('true')
    expect(trigger.classes()).toContain('dt-btn--soft')

    await wrapper.setProps({ currentPath: '/' })
    expect(trigger.attributes('aria-pressed')).toBe('false')
    expect(trigger.classes()).toContain('dt-btn--ghost')
  })

  it('悬停飞出、移出收回，aria-hidden 与显隐同源', async () => {
    const wrapper = render('/')
    const flyout = wrapper.get('.nav-flyout')
    expect(flyout.attributes('aria-hidden')).toBe('true')

    await wrapper.trigger('mouseenter')
    expect(flyout.classes()).toContain('is-open')
    expect(flyout.attributes('aria-hidden')).toBe('false')

    await wrapper.trigger('mouseleave')
    expect(flyout.classes()).not.toContain('is-open')
    expect(flyout.attributes('aria-hidden')).toBe('true')
  })

  it('当前子页的链接标 aria-current="page"，其余不落', () => {
    const wrapper = render('/system/users')
    const link = wrapper.get('a[href="/system/users"]')
    expect(link.attributes('aria-current')).toBe('page')
  })

  it('子项目标互为前缀时只有一个标 aria-current', () => {
    // ⚠ 与展开态同一口径：/knowledge 是 /knowledge/chat 的前缀，不能各按前缀判
    const wrapper = mount(AppNavGroupFlyout, {
      props: {
        item: {
          key: 'knowledge',
          label: '知识库',
          icon: 'search',
          children: [
            {
              key: 'manage',
              label: '管理',
              icon: 'folder-open',
              to: '/knowledge',
            },
            {
              key: 'chat',
              label: '对话',
              icon: 'sparkles',
              to: '/knowledge/chat',
            },
          ],
        },
        currentPath: '/knowledge/chat',
      },
    })
    const current = wrapper
      .findAll('a')
      .filter((link) => link.attributes('aria-current') === 'page')
    expect(current.map((link) => link.attributes('href'))).toEqual([
      '/knowledge/chat',
    ])
  })
})
