/**
 * @fileoverview 卡片的动作出口与权限门契约。
 * ⚠ 九个动作的事件名写错时 typecheck 与 lint 都放行，父组件只是收不到，
 * 所以每个动作都要有一条「点了它、父组件收到了什么」的断言。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { PERMISSION_CODES } from '@dt/contracts'

import type { DashboardSummary } from '@/api/dashboardWire'
import DashboardCard from '@/pages/Home/components/DashboardCard.vue'
import { useAuthStore } from '@/stores/auth'

vi.mock('@/api/dashboardThumbnail', () => ({
  getDashboardThumbnail: vi.fn().mockResolvedValue(null),
}))

const ALL_CODES = [
  PERMISSION_CODES.dashboardView,
  PERMISSION_CODES.dashboardEdit,
  PERMISSION_CODES.dashboardManage,
]

function dashboard(over: Partial<DashboardSummary> = {}): DashboardSummary {
  return {
    id: 'd-1',
    projectId: 'p-1',
    name: '产线总览',
    description: null,
    designWidth: 1920,
    designHeight: 1080,
    rowVersion: 7,
    schemaVersion: 1,
    isPublic: false,
    nodeCount: 12,
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
    ...over,
  }
}

function signIn(permissions: string[]): void {
  const auth = useAuthStore()
  auth.user = {
    username: 'u',
    role: { name: 'r' },
    role_permissions: permissions,
    direct_permissions: [],
    permissions,
  } as never
  auth.accessToken = 'token'
}

function render(over: Partial<DashboardSummary> = {}): VueWrapper {
  return mount(DashboardCard, {
    props: { dashboard: dashboard(over) },
    attachTo: document.body,
  })
}

async function openMenu(wrapper: VueWrapper): Promise<void> {
  const trigger = wrapper
    .findAll('button')
    .find((button) => button.attributes('aria-haspopup') === 'menu')
  await trigger?.trigger('click')
  await flushPromises()
}

function menuItem(label: string): HTMLElement | undefined {
  return [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
    (item) => item.textContent?.includes(label) === true,
  )
}

beforeEach(() => {
  setActivePinia(createPinia())
  signIn(ALL_CODES)
})

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('卡片展示', () => {
  it('给出名字、版本与相对更新时间', () => {
    const text = render({ updatedAt: new Date().toISOString() }).text()
    expect(text).toContain('产线总览')
    expect(text).toContain('v7')
    expect(text).toContain('刚刚')
  })

  it('公开的屏挂「已发布」角标，未公开的不挂', () => {
    expect(render({ isPublic: true }).text()).toContain('已发布')
    expect(render({ isPublic: false }).text()).not.toContain('已发布')
  })

  it('busy 时盖忙碌遮罩并写出文案', () => {
    const wrapper = mount(DashboardCard, {
      props: { dashboard: dashboard(), busy: true, busyLabel: '复制中…' },
    })
    const mask = wrapper.get('[data-test="card-busy"]')
    expect(mask.text()).toContain('复制中…')
  })

  it('不忙时没有遮罩', () => {
    expect(render().find('[data-test="card-busy"]').exists()).toBe(false)
  })
})

describe('悬浮层与卡片点击', () => {
  it('预览按钮发 preview', async () => {
    const wrapper = render()
    await wrapper.get('[data-test="card-preview"]').trigger('click')
    expect(wrapper.emitted('preview')).toHaveLength(1)
  })

  it('有编辑权时给编辑按钮，发 edit', async () => {
    const wrapper = render()
    await wrapper.get('[data-test="card-edit"]').trigger('click')
    expect(wrapper.emitted('edit')).toHaveLength(1)
  })

  it('只有读权限时不画编辑按钮——免得点进去被弹回来', () => {
    signIn([PERMISSION_CODES.dashboardView])
    expect(render().find('[data-test="card-edit"]').exists()).toBe(false)
  })

  it('点卡片空白处等于预览', async () => {
    const wrapper = render()
    await wrapper.get('section').trigger('click')
    expect(wrapper.emitted('preview')).toHaveLength(1)
  })

  it('忙碌时点卡片不发预览', async () => {
    const wrapper = mount(DashboardCard, {
      props: { dashboard: dashboard(), busy: true },
    })
    await wrapper.get('section').trigger('click')
    expect(wrapper.emitted('preview')).toBeUndefined()
  })
})

describe('⋯ 菜单', () => {
  const CASES = [
    ['编辑', 'edit'],
    ['创建副本', 'duplicate'],
    ['绑定自检', 'validate'],
    ['发布与分享', 'share'],
    ['另存为模板', 'save-as-template'],
    ['导出 JSON', 'export'],
    ['删除', 'delete'],
  ] as const

  for (const [label, event] of CASES) {
    it(`「${label}」发 ${event}`, async () => {
      const wrapper = render()
      await openMenu(wrapper)
      menuItem(label)?.click()
      await flushPromises()
      expect(wrapper.emitted(event)).toHaveLength(1)
      wrapper.unmount()
    })
  }

  it('只有读权限时菜单只剩自检与导出', async () => {
    signIn([PERMISSION_CODES.dashboardView])
    const wrapper = render()
    await openMenu(wrapper)
    const labels = [
      ...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ].map((item) => item.textContent?.trim())
    expect(labels).toEqual(['绑定自检', '导出 JSON'])
    wrapper.unmount()
  })

  it('一条动作都没有时连 ⋯ 按钮都不画', () => {
    signIn([])
    const wrapper = render()
    const trigger = wrapper
      .findAll('button')
      .find((button) => button.attributes('aria-haspopup') === 'menu')
    expect(trigger).toBeUndefined()
  })
})

describe('内联重命名', () => {
  async function startRename(wrapper: VueWrapper): Promise<void> {
    await openMenu(wrapper)
    menuItem('重命名')?.click()
    await flushPromises()
  }

  it('进重命名时输入框带着当前名字与可读名称', async () => {
    const wrapper = render()
    await startRename(wrapper)
    const field = wrapper.get<HTMLInputElement>('[data-test="inline-rename"]')
    expect(field.element.value).toBe('产线总览')
    expect(field.attributes('aria-label')).toBe('大屏名称')
    wrapper.unmount()
  })

  it('Enter 提交新名字', async () => {
    const wrapper = render()
    await startRename(wrapper)
    const field = wrapper.get('[data-test="inline-rename"]')
    await field.setValue('新名字')
    await field.trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('rename')).toEqual([['新名字']])
    wrapper.unmount()
  })

  it('Esc 取消，且随后的失焦不许再提交一遍', async () => {
    const wrapper = render()
    await startRename(wrapper)
    const field = wrapper.get('[data-test="inline-rename"]')
    await field.setValue('新名字')
    await field.trigger('keyup', { key: 'Escape' })
    await field.trigger('blur')
    expect(wrapper.emitted('rename')).toBeUndefined()
    wrapper.unmount()
  })

  it('失焦提交', async () => {
    const wrapper = render()
    await startRename(wrapper)
    const field = wrapper.get('[data-test="inline-rename"]')
    await field.setValue('另一个名字')
    await field.trigger('blur')
    expect(wrapper.emitted('rename')).toEqual([['另一个名字']])
    wrapper.unmount()
  })

  it('名字没改或被清空时不发 rename', async () => {
    const wrapper = render()
    await startRename(wrapper)
    const field = wrapper.get('[data-test="inline-rename"]')
    await field.setValue('   ')
    await field.trigger('blur')
    expect(wrapper.emitted('rename')).toBeUndefined()
    wrapper.unmount()
  })
})

describe('比例角标', () => {
  it('把设计尺寸约成最简比例，1920×1080 显示 16:9', () => {
    const wrapper = render()

    expect(wrapper.get('[data-test="card-aspect"]').text()).toBe('16:9')
  })

  it('带鱼屏与竖屏各自约对，不是恒显示 16:9', () => {
    const wide = render({ designWidth: 2560, designHeight: 1080 })
    const tall = render({ designWidth: 1080, designHeight: 1920 })

    expect(wide.get('[data-test="card-aspect"]').text()).toBe('64:27')
    expect(tall.get('[data-test="card-aspect"]').text()).toBe('9:16')
  })

  // ⚠ 角标上出现一个 NaN 比没有角标更难查：它看着像数据坏了而不是尺寸没填
  it('尺寸非法时给破折号而不是算出 NaN', () => {
    const wrapper = render({ designWidth: 0, designHeight: 0 })

    expect(wrapper.get('[data-test="card-aspect"]').text()).toBe('—')
  })
})
