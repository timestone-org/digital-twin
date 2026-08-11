/**
 * @fileoverview 角色行入口的可见性与分工：入口不因 is_builtin 整体消失，
 * 四颗钮只抛事件、一个请求都不发。
 */
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import type { RoleSummary } from '@dt/contracts'

import * as admin from '@/api/admin'
import RoleRowActions from '@/pages/System/Roles/components/RoleRowActions.vue'
import { useAuthStore } from '@/stores/auth'

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

function signIn(codes: string[]): void {
  const auth = useAuthStore()
  auth.user = { permissions: codes, role: { name: 'admin' } } as never
  auth.accessToken = 'token'
}

function render(codes: string[], over: Partial<RoleSummary> = {}) {
  signIn(codes)
  return mount(RoleRowActions, { props: { role: role(over) } })
}

beforeEach(() => {
  setActivePinia(createPinia())
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('RoleRowActions', () => {
  it('内置角色给的是只读入口，且没有删除', () => {
    const wrapper = render(['user:view', 'role:manage'])
    expect(wrapper.find('[aria-label="查看权限"]').exists()).toBe(true)
    expect(wrapper.find('[aria-label="设置权限"]').exists()).toBe(false)
    expect(wrapper.find('[aria-label="删除角色"]').exists()).toBe(false)
  })

  it('自定义角色四个入口齐全', () => {
    const wrapper = render(['user:view', 'role:manage'], { is_builtin: false })
    for (const label of [
      '设置权限',
      '以此为模板新建角色',
      '编辑角色',
      '删除角色',
    ]) {
      expect(wrapper.find(`[aria-label="${label}"]`).exists()).toBe(true)
    }
  })

  it('内置角色也能克隆——它正是不可改时的出路', () => {
    const wrapper = render(['role:manage'])
    expect(wrapper.find('[aria-label="以此为模板新建角色"]').exists()).toBe(
      true,
    )
  })

  it('只读账号仍看得到权限入口，写入口一个都不进 DOM', () => {
    const wrapper = render(['user:view'], { is_builtin: false })
    expect(wrapper.find('[aria-label="设置权限"]').exists()).toBe(true)
    expect(wrapper.find('[aria-label="以此为模板新建角色"]').exists()).toBe(
      false,
    )
    expect(wrapper.find('[aria-label="编辑角色"]').exists()).toBe(false)
    expect(wrapper.find('[aria-label="删除角色"]').exists()).toBe(false)
  })

  it('四颗钮只抛事件，一个请求都不发', async () => {
    const calls = [
      vi.spyOn(admin, 'updateRole'),
      vi.spyOn(admin, 'deleteRole'),
      vi.spyOn(admin, 'setRolePermissions'),
      vi.spyOn(admin, 'createRole'),
    ]
    const wrapper = render(['role:manage'], { is_builtin: false })
    const pairs = [
      ['设置权限', 'codes'],
      ['以此为模板新建角色', 'clone'],
      ['编辑角色', 'edit'],
      ['删除角色', 'remove'],
    ] as const
    for (const [label, event] of pairs) {
      await wrapper.find(`[aria-label="${label}"]`).trigger('click')
      expect(wrapper.emitted(event)?.[0]?.[0]).toMatchObject({ id: 'r1' })
    }
    for (const call of calls) expect(call).not.toHaveBeenCalled()
  })

  it('内置角色的权限入口在 title 里说清它为什么只读', () => {
    const wrapper = render(['user:view'])
    expect(wrapper.find('[aria-label="查看权限"]').attributes('title')).toBe(
      '查看权限（内置角色由种子维护）',
    )
  })
})
