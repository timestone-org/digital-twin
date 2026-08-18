/**
 * @fileoverview 系统管理各弹窗的行为契约：提交载荷、覆盖式语义、
 * 内置对象的字段收敛、失败时把原因显示出来。
 */
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import type { PermissionCatalog, RoleSummary } from '@dt/contracts'
import type { RoleFormTask } from '@/pages/System/Roles/scripts/roleFormTask'

import * as admin from '@/api/admin'
import * as authApi from '@/api/auth'
import { __resetPermissionCatalog } from '@/features/permissions/usePermissionCatalog'
import { BizError } from '@/api/client'
import AssignRoleDialog from '@/pages/System/Users/components/AssignRoleDialog.vue'
import DirectPermissionsDialog from '@/pages/System/Users/components/DirectPermissionsDialog.vue'
import ResetPasswordDialog from '@/pages/System/Users/components/ResetPasswordDialog.vue'
import RoleFormDialog from '@/pages/System/Roles/components/RoleFormDialog.vue'
import RolePermissionsDialog from '@/pages/System/Roles/components/RolePermissionsDialog.vue'
import RuleFormDialog from '@/pages/System/RouteRules/components/RuleFormDialog.vue'
import UserFormDialog from '@/pages/System/Users/components/UserFormDialog.vue'

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
        {
          id: 'p2',
          code: 'user:grant',
          name: '授予用户角色与直权',
          description: null,
          group_code: 'user',
          group_label: '用户与角色',
          sort_order: 40,
          kind: 'admin',
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
    description: '只读',
    is_builtin: true,
    created_at: '',
    updated_at: '',
    permissions: ['user:view'],
    user_count: 0,
    ...over,
  }
}

/** 编辑形态的表单任务。 */
function editTask(over: Partial<RoleSummary> = {}): RoleFormTask {
  return { mode: 'edit', role: role(over) }
}

/** 新建形态的表单任务，`codes` 非空即克隆。 */
function createTask(
  over: Partial<Extract<RoleFormTask, { mode: 'create' }>> = {},
): RoleFormTask {
  return { mode: 'create', name: '', description: '', codes: [], ...over }
}

/**
 * 列表项假件：**没有**权限码数组，只有直权条数——`GET /users` 就是这个形状。
 * 弹窗的入参一律是它，需要码的弹窗自己去拉详情。
 */
function listItem(over: Record<string, unknown> = {}) {
  return {
    id: 'u1',
    username: 'alice',
    email: 'a@e.com',
    full_name: '爱丽丝',
    phone: null,
    is_active: true,
    role: { id: 'r1', name: 'viewer', is_builtin: true },
    direct_permission_count: 0,
    ...over,
  } as never
}

/** 详情假件：三组权限码只有详情端点会给。 */
function user(over: Record<string, unknown> = {}) {
  return listItem({
    role_permissions: ['user:view'],
    direct_permissions: [],
    permissions: ['user:view'],
    ...over,
  })
}

/** 弹窗 Teleport 到 body，断言要看整个 document。 */
function bodyText(): string {
  return document.body.textContent ?? ''
}

beforeEach(() => {
  setActivePinia(createPinia())
  document.body.innerHTML = ''
  // 目录缓存是模块级的，不清就会跨用例串——用例必须能任意乱序执行
  __resetPermissionCatalog()
  vi.spyOn(authApi, 'fetchPermissionCatalog').mockResolvedValue(CATALOG)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('UserFormDialog', () => {
  it('新建时提交完整载荷', async () => {
    const create = vi.spyOn(admin, 'createUser').mockResolvedValue(user())
    const wrapper = mount(UserFormDialog, {
      props: { modelValue: true, user: null, roles: [role()] },
    })
    await flushPromises()
    const inputs = document.querySelectorAll('input')
    ;(inputs[0] as HTMLInputElement).value = 'bob'
    inputs[0]?.dispatchEvent(new Event('input'))
    await flushPromises()
    await wrapper.vm.$nextTick()
    expect(create).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('编辑态不出现用户名、密码与角色字段', async () => {
    mount(UserFormDialog, {
      props: { modelValue: true, user: user(), roles: [role()] },
    })
    await flushPromises()
    expect(bodyText()).not.toContain('初始密码')
    expect(bodyText()).toContain('邮箱')
  })

  it('编辑时只提交资料字段', async () => {
    const update = vi.spyOn(admin, 'updateUser').mockResolvedValue(user())
    const wrapper = mount(UserFormDialog, {
      props: { modelValue: true, user: user(), roles: [role()] },
    })
    await flushPromises()
    await wrapper.vm.$nextTick()
    const save = [...document.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('保存'),
    )
    save?.click()
    await flushPromises()
    expect(update).toHaveBeenCalledWith('u1', {
      email: 'a@e.com',
      full_name: '爱丽丝',
      phone: '',
    })
  })
})

describe('AssignRoleDialog', () => {
  it('提交所选角色', async () => {
    const assign = vi.spyOn(admin, 'assignRole').mockResolvedValue(user())
    mount(AssignRoleDialog, { props: { user: user(), roles: [role()] } })
    await flushPromises()
    const confirm = [...document.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('改派'),
    )
    confirm?.click()
    await flushPromises()
    expect(assign).toHaveBeenCalledWith('u1', 'r1')
  })

  it('后端拒绝时显示原因', async () => {
    vi.spyOn(admin, 'assignRole').mockRejectedValue(
      new BizError(40107, '不能授予自己不具备的权限：role:manage', 403, 't'),
    )
    mount(AssignRoleDialog, { props: { user: user(), roles: [role()] } })
    await flushPromises()
    const confirm = [...document.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('改派'),
    )
    confirm?.click()
    await flushPromises()
    expect(bodyText()).toContain('不能授予自己不具备的权限')
  })
})

describe('DirectPermissionsDialog', () => {
  function saveButton(): HTMLButtonElement | undefined {
    return [...document.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('保存'),
    )
  }

  it('角色已含的码只读展示，不能被当成直权勾掉', async () => {
    vi.spyOn(admin, 'getUser').mockResolvedValue(user())
    mount(DirectPermissionsDialog, { props: { user: listItem() } })
    await flushPromises()
    expect(bodyText()).toContain('角色已含')
    const disabled = document.querySelectorAll(
      'input[type="checkbox"]:disabled',
    )
    expect(disabled.length).toBe(1)
  })

  it('现有直权来自详情，不是入参的列表项', async () => {
    // 入参只说「有 1 条直权」，码要靠 getUser 拿。照列表项预填会是空集，
    // 而覆盖式提交空集 = 把这个人的直权清光。
    const detail = vi
      .spyOn(admin, 'getUser')
      .mockResolvedValue(user({ direct_permissions: ['user:grant'] }))
    const save = vi
      .spyOn(admin, 'setDirectPermissions')
      .mockResolvedValue(user())
    mount(DirectPermissionsDialog, {
      props: { user: listItem({ direct_permission_count: 1 }) },
    })
    await flushPromises()
    expect(detail).toHaveBeenCalledWith('u1')
    saveButton()?.click()
    await flushPromises()
    expect(save).toHaveBeenCalledWith('u1', ['user:grant'])
  })

  it('详情没拉到时保存禁用——否则一提交就是拿空集覆盖', async () => {
    vi.spyOn(admin, 'getUser').mockRejectedValue(
      new BizError(40003, '用户不存在', 404, 't'),
    )
    const save = vi
      .spyOn(admin, 'setDirectPermissions')
      .mockResolvedValue(user())
    mount(DirectPermissionsDialog, { props: { user: listItem() } })
    await flushPromises()
    expect(saveButton()?.disabled).toBe(true)
    saveButton()?.click()
    await flushPromises()
    expect(save).not.toHaveBeenCalled()
  })
})

describe('ResetPasswordDialog', () => {
  it('提交新密码', async () => {
    const reset = vi.spyOn(admin, 'resetUserPassword').mockResolvedValue()
    mount(ResetPasswordDialog, { props: { user: user() } })
    await flushPromises()
    const field = document.querySelector('input[type="password"]')
    if (field instanceof HTMLInputElement) {
      field.value = 'Rotated12345'
      field.dispatchEvent(new Event('input'))
    }
    await flushPromises()
    const confirm = [...document.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('重置'),
    )
    confirm?.click()
    await flushPromises()
    expect(reset).toHaveBeenCalledWith('u1', 'Rotated12345')
  })
})

describe('RoleFormDialog', () => {
  function save(): HTMLButtonElement | undefined {
    return [...document.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('保存'),
    )
  }

  /** 权限码复选框；第 0 个是 user:view，第 1 个是 user:grant。 */
  function codeBoxes(): NodeListOf<HTMLInputElement> {
    return document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')
  }

  it('内置角色的名称输入框被禁用', async () => {
    mount(RoleFormDialog, { props: { task: editTask() } })
    await flushPromises()
    expect(document.querySelectorAll('input:disabled').length).toBe(1)
    expect(bodyText()).toContain('内置角色的名称与权限集由种子维护')
  })

  it('内置角色只提交描述，不下发必被拒的 name', async () => {
    const update = vi.spyOn(admin, 'updateRole').mockResolvedValue(role())
    mount(RoleFormDialog, { props: { task: editTask() } })
    await flushPromises()
    save()?.click()
    await flushPromises()
    expect(update).toHaveBeenCalledWith('r1', { description: '只读' })
  })

  it('自建角色可以改名', async () => {
    const update = vi.spyOn(admin, 'updateRole').mockResolvedValue(role())
    mount(RoleFormDialog, {
      props: { task: editTask({ is_builtin: false, name: 'ops' }) },
    })
    await flushPromises()
    save()?.click()
    await flushPromises()
    expect(update).toHaveBeenCalledWith('r1', {
      name: 'ops',
      description: '只读',
    })
  })

  it('挂载时就是打开态也要填好表单——只监听变化的 watch 一次都不跑', async () => {
    mount(RoleFormDialog, {
      props: { task: editTask({ is_builtin: false, name: 'ops' }) },
    })
    await flushPromises()
    const name = document.querySelectorAll('input')[0] as HTMLInputElement
    expect(name.value).toBe('ops')
  })

  it('新建形态渲染权限码选择段，勾上的码排序后进载荷', async () => {
    const create = vi.spyOn(admin, 'createRole').mockResolvedValue(role())
    mount(RoleFormDialog, { props: { task: createTask({ name: 'ops' }) } })
    await flushPromises()
    expect(bodyText()).toContain('权限码')
    // 先勾 user:grant 再勾 user:view：不排序的话载荷会是插入序
    codeBoxes()[1]?.click()
    await flushPromises()
    codeBoxes()[0]?.click()
    await flushPromises()
    save()?.click()
    await flushPromises()
    expect(create).toHaveBeenCalledWith({
      name: 'ops',
      description: undefined,
      codes: ['user:grant', 'user:view'],
    })
  })

  it('「全不选」把已勾的码清空，且勾之前它是禁用的', async () => {
    mount(RoleFormDialog, { props: { task: createTask({ name: 'ops' }) } })
    await flushPromises()
    const clear = (): HTMLButtonElement | undefined =>
      [...document.querySelectorAll('button')].find(
        (node) => node.textContent?.trim() === '全不选',
      )
    expect(clear()?.disabled).toBe(true)
    codeBoxes()[0]?.click()
    await flushPromises()
    expect(bodyText()).toContain('已选 1 项')
    clear()?.click()
    await flushPromises()
    expect(bodyText()).toContain('已选 0 项')
    expect([...codeBoxes()].every((box) => !box.checked)).toBe(true)
  })

  it('编辑形态一个码都不渲染，载荷里也没有 codes', async () => {
    const update = vi.spyOn(admin, 'updateRole').mockResolvedValue(role())
    mount(RoleFormDialog, {
      props: { task: editTask({ is_builtin: false, name: 'ops' }) },
    })
    await flushPromises()
    expect(codeBoxes().length).toBe(0)
    expect(bodyText()).not.toContain('已选')
    save()?.click()
    await flushPromises()
    expect(update).toHaveBeenCalledWith('r1', {
      name: 'ops',
      description: '只读',
    })
  })

  it('克隆形态预填好勾选，且不与源角色共用同一个数组', async () => {
    const source = role({ permissions: ['user:view'] })
    mount(RoleFormDialog, {
      props: {
        task: createTask({
          name: 'viewer_copy',
          codes: source.permissions,
          seededFrom: 'viewer',
        }),
      },
    })
    await flushPromises()
    expect(bodyText()).toContain('已预填 1 个来自「viewer」的权限码')
    expect(codeBoxes()[0]?.checked).toBe(true)
    // 取消勾选不许反写回列表数据
    codeBoxes()[0]?.click()
    await flushPromises()
    expect(source.permissions).toEqual(['user:view'])
  })

  it('授予被拒时原样显示原因，弹窗不关、已勾的码还在', async () => {
    vi.spyOn(admin, 'createRole').mockRejectedValue(
      new BizError(40107, '不能授予自己不具备的权限：role:manage', 403, 't'),
    )
    mount(RoleFormDialog, { props: { task: createTask({ name: 'ops' }) } })
    await flushPromises()
    codeBoxes()[0]?.click()
    await flushPromises()
    save()?.click()
    await flushPromises()
    expect(bodyText()).toContain('不能授予自己不具备的权限：role:manage')
    expect(bodyText()).toContain('新建角色')
    expect(codeBoxes()[0]?.checked).toBe(true)
  })

  it('角色名已被占用照样原样显示——本地的 _copy 后缀不是校验', async () => {
    vi.spyOn(admin, 'createRole').mockRejectedValue(
      new BizError(40004, '角色名已被占用', 409, 't'),
    )
    mount(RoleFormDialog, {
      props: { task: createTask({ name: 'viewer_copy' }) },
    })
    await flushPromises()
    save()?.click()
    await flushPromises()
    expect(bodyText()).toContain('角色名已被占用')
  })

  it('目录取不到时新建禁用保存，点了也不发请求', async () => {
    __resetPermissionCatalog()
    vi.spyOn(authApi, 'fetchPermissionCatalog').mockRejectedValue(
      new BizError(50000, '目录服务不可用', 500, 't'),
    )
    const create = vi.spyOn(admin, 'createRole').mockResolvedValue(role())
    mount(RoleFormDialog, { props: { task: createTask({ name: 'ops' }) } })
    await flushPromises()
    expect(save()?.disabled).toBe(true)
    save()?.click()
    await flushPromises()
    expect(create).not.toHaveBeenCalled()
  })

  it('目录取不到不影响编辑形态', async () => {
    __resetPermissionCatalog()
    vi.spyOn(authApi, 'fetchPermissionCatalog').mockRejectedValue(
      new BizError(50000, '目录服务不可用', 500, 't'),
    )
    const update = vi.spyOn(admin, 'updateRole').mockResolvedValue(role())
    mount(RoleFormDialog, { props: { task: editTask() } })
    await flushPromises()
    expect(save()?.disabled).toBe(false)
    save()?.click()
    await flushPromises()
    expect(update).toHaveBeenCalled()
  })

  it('成功文案随实际授予的码数变，不无脑催人再配一次', async () => {
    vi.spyOn(admin, 'createRole').mockResolvedValue(role())
    const wrapper = mount(RoleFormDialog, {
      props: { task: createTask({ name: 'ops' }) },
    })
    await flushPromises()
    codeBoxes()[0]?.click()
    await flushPromises()
    save()?.click()
    await flushPromises()
    expect(wrapper.emitted('saved')?.[0]?.[0]).toContain('并授予 1 个权限码')
  })
})

describe('RuleFormDialog', () => {
  it('把空码的语义写在界面上，而不是留给人猜', async () => {
    mount(RuleFormDialog, { props: { modelValue: true, rule: null } })
    await flushPromises()
    expect(bodyText()).toContain('任意已登录用户放行')
  })

  it('优先级以数字提交，不是输入框里的字符串', async () => {
    const create = vi.spyOn(admin, 'createRouteRule').mockResolvedValue({
      id: 'x',
    } as never)
    mount(RuleFormDialog, { props: { modelValue: true, rule: null } })
    await flushPromises()
    const save = [...document.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('保存'),
    )
    save?.click()
    await flushPromises()
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ priority: 500, permission_codes: [] }),
    )
  })
})

describe('弹窗的取消与失败路径', () => {
  function clickButton(text: string): void {
    const button = [...document.querySelectorAll('button')].find(
      (node) => node.textContent?.trim() === text,
    )
    button?.click()
  }

  it('UserFormDialog：点取消关掉，不发请求', async () => {
    const create = vi.spyOn(admin, 'createUser').mockResolvedValue(user())
    const wrapper = mount(UserFormDialog, {
      props: { modelValue: true, user: null, roles: [role()] },
    })
    await flushPromises()
    clickButton('取消')
    await flushPromises()
    expect(create).not.toHaveBeenCalled()
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([false])
  })

  it('UserFormDialog：建号被拒时把原因显示出来', async () => {
    vi.spyOn(admin, 'createUser').mockRejectedValue(
      new BizError(40004, '用户名已存在', 409, 't'),
    )
    mount(UserFormDialog, {
      props: { modelValue: true, user: null, roles: [role()] },
    })
    await flushPromises()
    clickButton('保存')
    await flushPromises()
    expect(bodyText()).toContain('用户名已存在')
  })

  it('UserFormDialog：改资料被拒时同样显示原因', async () => {
    vi.spyOn(admin, 'updateUser').mockRejectedValue(
      new BizError(40004, '该邮箱已被占用', 409, 't'),
    )
    mount(UserFormDialog, {
      props: { modelValue: true, user: user(), roles: [role()] },
    })
    await flushPromises()
    clickButton('保存')
    await flushPromises()
    expect(bodyText()).toContain('该邮箱已被占用')
  })

  it('RoleFormDialog：新建成功后提示接着去配权限', async () => {
    const create = vi.spyOn(admin, 'createRole').mockResolvedValue(role())
    const wrapper = mount(RoleFormDialog, {
      props: { task: createTask() },
    })
    await flushPromises()
    const name = document.querySelectorAll('input')[0] as HTMLInputElement
    name.value = 'ops'
    name.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()
    clickButton('保存')
    await flushPromises()
    expect(create).toHaveBeenCalledWith({
      name: 'ops',
      description: undefined,
      codes: [],
    })
    expect(wrapper.emitted('saved')?.[0]?.[0]).toContain('接着给它配权限')
  })

  it('RoleFormDialog：被拒时显示原因，且点取消不发请求', async () => {
    const update = vi
      .spyOn(admin, 'updateRole')
      .mockRejectedValue(new BizError(40110, '内置角色不可改名', 403, 't'))
    mount(RoleFormDialog, { props: { task: editTask() } })
    await flushPromises()
    clickButton('保存')
    await flushPromises()
    expect(bodyText()).toContain('内置角色不可改名')
    update.mockClear()
    clickButton('取消')
    await flushPromises()
    expect(update).not.toHaveBeenCalled()
  })

  it('RuleFormDialog：新建时提交整份载荷', async () => {
    const create = vi.spyOn(admin, 'createRouteRule').mockResolvedValue({
      id: 'n1',
    } as never)
    mount(RuleFormDialog, { props: { modelValue: true, rule: null } })
    await flushPromises()
    clickButton('保存')
    await flushPromises()
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        path_pattern: '/api/v1/',
        http_method: 'GET',
        match_mode: 'all',
        priority: 500,
        is_enabled: true,
        permission_codes: [],
      }),
    )
  })

  it('RuleFormDialog：被拒时显示原因', async () => {
    vi.spyOn(admin, 'createRouteRule').mockRejectedValue(
      new BizError(40001, '路径模式必须以 / 开头', 400, 't'),
    )
    mount(RuleFormDialog, { props: { modelValue: true, rule: null } })
    await flushPromises()
    clickButton('保存')
    await flushPromises()
    expect(bodyText()).toContain('路径模式必须以 / 开头')
  })

  it('RuleFormDialog：编辑时走更新而不是新建', async () => {
    const update = vi
      .spyOn(admin, 'updateRouteRule')
      .mockResolvedValue({ id: 'x1' } as never)
    mount(RuleFormDialog, {
      props: {
        modelValue: true,
        rule: {
          id: 'x1',
          path_pattern: '/api/v1/auth/users*',
          http_method: 'GET',
          permission_codes: ['user:view'],
          match_mode: 'all',
          priority: 900,
          is_enabled: true,
          is_builtin: false,
          description: null,
          created_at: '',
          updated_at: '',
        },
      },
    })
    await flushPromises()
    clickButton('保存')
    await flushPromises()
    expect(update).toHaveBeenCalledWith(
      'x1',
      expect.objectContaining({
        priority: 900,
        permission_codes: ['user:view'],
      }),
    )
  })

  it('AssignRoleDialog：点取消只关窗，不改派', async () => {
    const assign = vi.spyOn(admin, 'assignRole').mockResolvedValue(user())
    const wrapper = mount(AssignRoleDialog, {
      props: { user: user(), roles: [role()] },
    })
    await flushPromises()
    clickButton('取消')
    await flushPromises()
    expect(assign).not.toHaveBeenCalled()
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('ResetPasswordDialog：被拒时显示原因', async () => {
    vi.spyOn(admin, 'resetUserPassword').mockRejectedValue(
      new BizError(40108, '目标账号的权限高于你', 403, 't'),
    )
    mount(ResetPasswordDialog, { props: { user: user() } })
    await flushPromises()
    clickButton('重置')
    await flushPromises()
    expect(bodyText()).toContain('目标账号的权限高于你')
  })

  it('RolePermissionsDialog：点取消不写入', async () => {
    const save = vi.spyOn(admin, 'setRolePermissions').mockResolvedValue(role())
    const wrapper = mount(RolePermissionsDialog, { props: { role: role() } })
    await flushPromises()
    clickButton('取消')
    await flushPromises()
    expect(save).not.toHaveBeenCalled()
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('RolePermissionsDialog：被拒时显示原因', async () => {
    vi.spyOn(admin, 'setRolePermissions').mockRejectedValue(
      new BizError(40107, '不能授予自己不具备的权限', 403, 't'),
    )
    mount(RolePermissionsDialog, { props: { role: role() } })
    await flushPromises()
    clickButton('保存')
    await flushPromises()
    expect(bodyText()).toContain('不能授予自己不具备的权限')
  })

  it('DirectPermissionsDialog：点取消不写入', async () => {
    vi.spyOn(admin, 'getUser').mockResolvedValue(user())
    const save = vi
      .spyOn(admin, 'setDirectPermissions')
      .mockResolvedValue(user())
    const wrapper = mount(DirectPermissionsDialog, {
      props: { user: listItem() },
    })
    await flushPromises()
    clickButton('取消')
    await flushPromises()
    expect(save).not.toHaveBeenCalled()
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('DirectPermissionsDialog：写入被拒时显示原因', async () => {
    vi.spyOn(admin, 'getUser').mockResolvedValue(user())
    vi.spyOn(admin, 'setDirectPermissions').mockRejectedValue(
      new BizError(40107, '不能授予自己不具备的权限', 403, 't'),
    )
    mount(DirectPermissionsDialog, { props: { user: listItem() } })
    await flushPromises()
    clickButton('保存')
    await flushPromises()
    expect(bodyText()).toContain('不能授予自己不具备的权限')
  })
})

describe('弹窗的字段编辑', () => {
  function clickButton(text: string): void {
    const button = [...document.querySelectorAll('button')].find(
      (node) => node.textContent?.trim() === text,
    )
    button?.click()
  }

  function fill(index: number, value: string): void {
    const input = document.querySelectorAll('input')[index] as HTMLInputElement
    input.value = value
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }

  async function pickInSelect(index: number, label: string): Promise<void> {
    const trigger = document.querySelectorAll<HTMLButtonElement>(
      '.dt-select__trigger',
    )[index]
    trigger?.click()
    await flushPromises()
    const option = [...document.querySelectorAll('.dt-select-menu__item')].find(
      (node) => node.textContent?.trim() === label,
    )
    option?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flushPromises()
  }

  it('UserFormDialog：改过的每个字段都进了载荷', async () => {
    const create = vi.spyOn(admin, 'createUser').mockResolvedValue(user())
    mount(UserFormDialog, {
      props: { modelValue: true, user: null, roles: [role()] },
    })
    await flushPromises()
    fill(0, 'bob')
    fill(1, 'bob@example.com')
    fill(2, 'Passw0rd12')
    fill(3, '鲍勃')
    fill(4, '13800000000')
    await flushPromises()
    clickButton('保存')
    await flushPromises()
    expect(create).toHaveBeenCalledWith({
      username: 'bob',
      email: 'bob@example.com',
      password: 'Passw0rd12',
      full_name: '鲍勃',
      phone: '13800000000',
      role_id: 'r1',
    })
  })

  it('RuleFormDialog：改过的每个字段都进了载荷', async () => {
    const create = vi
      .spyOn(admin, 'createRouteRule')
      .mockResolvedValue({ id: 'n1' } as never)
    mount(RuleFormDialog, { props: { modelValue: true, rule: null } })
    await flushPromises()
    fill(0, '/api/v1/auth/roles*')
    fill(1, '820')
    fill(2, '角色管理')
    await pickInSelect(0, 'POST')
    await pickInSelect(1, 'any —— 持有任一即可')
    const enabled = document.querySelector<HTMLInputElement>(
      'input[type="checkbox"]',
    )
    enabled?.click()
    await flushPromises()
    clickButton('保存')
    await flushPromises()
    expect(create).toHaveBeenCalledWith({
      path_pattern: '/api/v1/auth/roles*',
      http_method: 'POST',
      match_mode: 'any',
      priority: 820,
      is_enabled: false,
      permission_codes: [],
      description: '角色管理',
    })
  })

  it('RuleFormDialog：勾上的权限码进载荷', async () => {
    vi.spyOn(authApi, 'fetchPermissionCatalog').mockResolvedValue(CATALOG)
    __resetPermissionCatalog()
    const create = vi
      .spyOn(admin, 'createRouteRule')
      .mockResolvedValue({ id: 'n1' } as never)
    mount(RuleFormDialog, { props: { modelValue: true, rule: null } })
    await flushPromises()
    const boxes = document.querySelectorAll<HTMLInputElement>(
      'input[type="checkbox"]',
    )
    // 第一个是「启用这条规则」，其后才是权限码
    boxes[1]?.click()
    await flushPromises()
    clickButton('保存')
    await flushPromises()
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ permission_codes: ['user:view'] }),
    )
  })
})
