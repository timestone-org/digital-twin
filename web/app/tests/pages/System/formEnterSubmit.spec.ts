/** @fileoverview 系统管理三张表单：表单里要有提交键，回车才会提交（页脚的保存键在表单外）。 */
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

import * as admin from '@/api/admin'
import UserFormDialog from '@/pages/System/Users/components/UserFormDialog.vue'

beforeEach(() => {
  setActivePinia(createPinia())
  document.body.innerHTML = ''
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('UserFormDialog 的回车提交', () => {
  it('表单内有提交键，提交只发一次请求', async () => {
    const create = vi
      .spyOn(admin, 'createUser')
      .mockResolvedValue({ id: 'u1' } as never)
    mount(UserFormDialog, {
      props: { modelValue: true, user: null, roles: [] },
      attachTo: document.body,
    })
    await flushPromises()
    const form = document.querySelector('form')
    expect(form?.querySelector('button[type="submit"]')).not.toBeNull()
    form?.dispatchEvent(new Event('submit', { cancelable: true }))
    form?.dispatchEvent(new Event('submit', { cancelable: true }))
    await flushPromises()
    expect(create).toHaveBeenCalledTimes(1)
  })
})

describe('UserFormDialog 的默认角色', () => {
  it('新建时不动角色就存，落在权限最少的那个上而不是列表第一个', async () => {
    const create = vi
      .spyOn(admin, 'createUser')
      .mockResolvedValue({ id: 'u1' } as never)
    const role = (id: string, name: string, permissions: string[]) => ({
      id,
      name,
      description: null,
      is_builtin: true,
      created_at: '',
      updated_at: '',
      permissions,
      user_count: 0,
    })
    mount(UserFormDialog, {
      props: {
        modelValue: true,
        user: null,
        roles: [
          role('r-admin', 'admin', ['user:grant', 'role:manage', 'user:view']),
          role('r-viewer', 'viewer', ['user:view']),
        ],
      },
      attachTo: document.body,
    })
    await flushPromises()
    document.querySelector('form')?.dispatchEvent(new Event('submit'))
    await flushPromises()
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ role_id: 'r-viewer' }),
    )
  })
})
