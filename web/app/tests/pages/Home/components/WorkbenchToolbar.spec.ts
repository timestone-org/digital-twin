/**
 * @fileoverview 工具条的三个入口与搜索框契约。
 * ⚠ 按钮的 `data-test` 与事件名写错时 typecheck 与 lint 双双放行，
 * 父页面只是收不到——每个入口都要有一条「点了它父组件收到什么」的断言。
 */
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { PERMISSION_CODES } from '@dt/contracts'

import type { ProjectSummary } from '@/api/dashboardWire'
import WorkbenchToolbar from '@/pages/Home/components/WorkbenchToolbar.vue'
import { useAuthStore } from '@/stores/auth'

const PROJECT: ProjectSummary = {
  id: 'p-1',
  name: 'A 园区',
  description: '园区能源',
  themeJson: {},
  brandJson: {},
  dashboardCount: 3,
  createdAt: '2026-08-01T00:00:00Z',
  updatedAt: '2026-08-01T00:00:00Z',
}

function signIn(codes: string[]): void {
  const auth = useAuthStore()
  auth.user = {
    username: 'u',
    role: { name: 'r' },
    role_permissions: codes,
    direct_permissions: [],
    permissions: codes,
  } as never
  auth.accessToken = 'token'
}

function render(search = ''): VueWrapper {
  return mount(WorkbenchToolbar, {
    props: { project: PROJECT, total: 3, listed: 3, search },
  })
}

beforeEach(() => {
  setActivePinia(createPinia())
  signIn([
    PERMISSION_CODES.dashboardView,
    PERMISSION_CODES.dashboardEdit,
    PERMISSION_CODES.dashboardManage,
  ])
})

describe('搜索框', () => {
  // ⚠ 搜不到时空态只说「改个词」，得有个地方能一下退回全部
  it('有搜索词时才出清空键，点了把词清成空串', async () => {
    const wrapper = render('总览')

    await wrapper.get('[data-test="clear-search"]').trigger('click')

    expect(wrapper.emitted('update:search')).toEqual([['']])
  })

  it('没有搜索词时不画清空键', () => {
    expect(render('').find('[data-test="clear-search"]').exists()).toBe(false)
  })
})

describe('三个入口', () => {
  it('设置 / 导入 / 新建大屏各自抛自己的事件', async () => {
    const wrapper = render()

    await wrapper.get('[data-test="open-project-settings"]').trigger('click')
    await wrapper.get('[data-test="open-import"]').trigger('click')
    await wrapper.get('[data-test="open-new-dashboard"]').trigger('click')

    expect(wrapper.emitted('settings')).toHaveLength(1)
    expect(wrapper.emitted('import')).toHaveLength(1)
    expect(wrapper.emitted('create')).toHaveLength(1)
  })

  it('只有读权限时建屏与导入两个入口都不渲染', () => {
    setActivePinia(createPinia())
    signIn([PERMISSION_CODES.dashboardView])
    const wrapper = render()

    expect(wrapper.find('[data-test="open-import"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="open-new-dashboard"]').exists()).toBe(
      false,
    )
  })
})

describe('项目摘要', () => {
  it('项目名与描述都出现在头部', () => {
    const text = render().text()

    expect(text).toContain('A 园区')
    expect(text).toContain('园区能源')
  })
})
