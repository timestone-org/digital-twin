/**
 * @fileoverview 网格空态的两种形态与它们的入口。
 *
 * ⚠ 「还没有大屏」必须把新建与导入两个入口摆在空态里：那是新用户第一眼看到的
 * 地方。这两条断言是它们唯一的防线——空态少一个入口不会让 typecheck、lint 或
 * 任何别的用例报错，界面上只是安静地少一个按钮。
 */
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { PERMISSION_CODES } from '@dt/contracts'

import DashboardGridEmpty from '@/pages/Home/components/DashboardGridEmpty.vue'
import { useAuthStore } from '@/stores/auth'

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

function render(props: { search: string; canManage: boolean }): VueWrapper {
  return mount(DashboardGridEmpty, { props })
}

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('还没有大屏', () => {
  beforeEach(() => {
    signIn([PERMISSION_CODES.dashboardManage])
  })

  it('把新建与导入两个入口摆在空态里', () => {
    const wrapper = render({ search: '', canManage: true })

    expect(wrapper.find('[data-test="empty-create-dashboard"]').exists()).toBe(
      true,
    )
    expect(wrapper.find('[data-test="empty-import-dashboard"]').exists()).toBe(
      true,
    )
  })

  it('点新建抛 create，点导入抛 import', async () => {
    const wrapper = render({ search: '', canManage: true })

    await wrapper.get('[data-test="empty-create-dashboard"]').trigger('click')
    await wrapper.get('[data-test="empty-import-dashboard"]').trigger('click')

    expect(wrapper.emitted('create')).toHaveLength(1)
    expect(wrapper.emitted('import')).toHaveLength(1)
  })

  it('有建屏权限时文案是引导，没有时是解释', () => {
    const guided = render({ search: '', canManage: true }).text()

    expect(guided).toContain('模板库')
    expect(render({ search: '', canManage: false }).text()).toContain(
      '联系管理员',
    )
  })
})

describe('没有建屏权限', () => {
  beforeEach(() => {
    signIn([PERMISSION_CODES.dashboardView])
  })

  it('两个入口都不渲染——画出来也是点进去被弹回', () => {
    const wrapper = render({ search: '', canManage: false })

    expect(wrapper.find('[data-test="empty-create-dashboard"]').exists()).toBe(
      false,
    )
    expect(wrapper.find('[data-test="empty-import-dashboard"]').exists()).toBe(
      false,
    )
  })
})

describe('搜不到', () => {
  beforeEach(() => {
    signIn([PERMISSION_CODES.dashboardManage])
  })

  it('把搜索词回显出来，用户才知道是这个词没命中', () => {
    expect(render({ search: '总览', canManage: true }).text()).toContain('总览')
  })

  // ⚠ 搜不到时用户要的是改词，不是建一张新屏；给建屏入口会把人往错路上引
  it('搜不到时不给新建与导入入口', () => {
    const wrapper = render({ search: '总览', canManage: true })

    expect(wrapper.find('[data-test="empty-create-dashboard"]').exists()).toBe(
      false,
    )
    expect(wrapper.find('[data-test="empty-import-dashboard"]').exists()).toBe(
      false,
    )
  })

  it('只有空白的搜索词不算在搜索', () => {
    expect(render({ search: '   ', canManage: true }).text()).toContain(
      '还没有大屏',
    )
  })
})
