/**
 * @fileoverview 只读权限弹窗：说清为什么改不了、给出克隆这条出路，
 * 且目录取不到时也不留白。
 */
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import type { PermissionCatalog, RoleSummary } from '@dt/contracts'

import * as authApi from '@/api/auth'
import { BizError } from '@/api/client'
import { __resetPermissionCatalog } from '@/features/permissions/usePermissionCatalog'
import RoleCodesViewDialog from '@/pages/System/Roles/components/RoleCodesViewDialog.vue'
import { useAuthStore } from '@/stores/auth'

const CATALOG: PermissionCatalog = {
  items: [],
  groups: [
    {
      code: 'user',
      label: '用户与角色',
      items: [
        {
          id: 'p1',
          code: 'user:view',
          name: '查看用户与角色',
          description: null,
          group_code: 'user',
          group_label: '用户与角色',
          sort_order: 10,
          kind: 'view',
          is_builtin: true,
        },
      ],
    },
  ],
}

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

function bodyText(): string {
  return document.body.textContent ?? ''
}

function clickButton(text: string): void {
  const button = [...document.querySelectorAll('button')].find(
    (node) => node.textContent?.trim() === text,
  )
  button?.click()
}

beforeEach(() => {
  setActivePinia(createPinia())
  document.body.innerHTML = ''
  __resetPermissionCatalog()
  vi.spyOn(authApi, 'fetchPermissionCatalog').mockResolvedValue(CATALOG)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('RoleCodesViewDialog', () => {
  it('内置角色说清原因，而不是只把按钮禁掉', async () => {
    signIn(['role:manage'])
    mount(RoleCodesViewDialog, { props: { role: role() } })
    await flushPromises()
    expect(bodyText()).toContain('由系统种子维护')
    expect(bodyText()).toContain('下一次服务启动的种子同步也会把它覆盖回')
  })

  it('是只读视图，没有保存按钮', async () => {
    signIn(['role:manage'])
    mount(RoleCodesViewDialog, { props: { role: role() } })
    await flushPromises()
    const labels = [...document.querySelectorAll('button')].map((node) =>
      node.textContent?.trim(),
    )
    expect(labels).not.toContain('保存')
    expect(labels).toContain('关闭')
  })

  it('缺 role:manage 时点明缺的是哪个码', async () => {
    signIn(['user:view'])
    mount(RoleCodesViewDialog, { props: { role: role({ is_builtin: false }) } })
    await flushPromises()
    expect(bodyText()).toContain('你没有「管理角色与角色权限」（role:manage）')
  })

  it('按目录分组列出持有的码', async () => {
    signIn(['role:manage'])
    mount(RoleCodesViewDialog, { props: { role: role() } })
    await flushPromises()
    expect(bodyText()).toContain('用户与角色')
    expect(bodyText()).toContain('查看用户与角色')
  })

  it('点「以此为模板新建角色」抛 clone 并关掉自己', async () => {
    signIn(['role:manage'])
    const wrapper = mount(RoleCodesViewDialog, { props: { role: role() } })
    await flushPromises()
    clickButton('以此为模板新建角色')
    await flushPromises()
    expect(wrapper.emitted('clone')?.[0]?.[0]).toMatchObject({ id: 'r1' })
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('点「关闭」抛 close——只读弹窗也得有一条出去的路', async () => {
    signIn(['role:manage'])
    const wrapper = mount(RoleCodesViewDialog, { props: { role: role() } })
    await flushPromises()
    clickButton('关闭')
    await flushPromises()
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('没有 role:manage 就没有克隆按钮', async () => {
    signIn(['user:view'])
    mount(RoleCodesViewDialog, { props: { role: role() } })
    await flushPromises()
    expect(bodyText()).not.toContain('以此为模板新建角色')
  })

  it('目录取不到也照样把码全显示出来，并说明原因', async () => {
    __resetPermissionCatalog()
    vi.spyOn(authApi, 'fetchPermissionCatalog').mockRejectedValue(
      new BizError(50000, '目录服务不可用', 500, 't'),
    )
    signIn(['role:manage'])
    mount(RoleCodesViewDialog, {
      props: { role: role({ permissions: ['user:view', 'role:manage'] }) },
    })
    await flushPromises()
    expect(bodyText()).toContain('目录服务不可用')
    expect(bodyText()).toContain('user:view')
    expect(bodyText()).toContain('role:manage')
  })

  it('role 为 null 时整个弹窗不在 DOM 里', async () => {
    signIn(['role:manage'])
    mount(RoleCodesViewDialog, { props: { role: null } })
    await flushPromises()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })
})
