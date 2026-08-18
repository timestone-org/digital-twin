/**
 * @fileoverview 九个入口分别开哪一个弹窗。
 * ⚠ 弹窗名是普通字符串，接错一个不会报错、只会点开另一个弹窗，
 * 所以每个入口都要有一条「点它、开的是哪个」的断言。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { PERMISSION_CODES } from '@dt/contracts'

import * as dashboardApi from '@/api/dashboard'
import type { DashboardSummary, ProjectSummary } from '@/api/dashboardWire'
import HomePage from '@/pages/Home/index.vue'
import { useAuthStore } from '@/stores/auth'

const open = vi.fn()
vi.mock('@/pages/Home/scripts/useWorkbenchDialogs', () => ({
  useWorkbenchDialogs: () => ({
    openName: { value: null },
    target: { value: null },
    isOpen: () => false,
    open,
    close: vi.fn(),
  }),
}))

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useRoute: () => ({ path: '/', query: {} }),
  RouterLink: { props: ['to'], template: '<a><slot /></a>' },
}))

vi.mock('@/api/dashboardThumbnail', () => ({
  getDashboardThumbnail: vi.fn().mockResolvedValue(null),
}))

const PROJECT: ProjectSummary = {
  id: 'p-1',
  name: '一号厂区',
  description: null,
  themeJson: {},
  brandJson: {},
  dashboardCount: 1,
  createdAt: '2026-08-01T00:00:00Z',
  updatedAt: '2026-08-01T00:00:00Z',
}

const DASHBOARD: DashboardSummary = {
  id: 'd-1',
  projectId: 'p-1',
  name: '产线总览',
  description: null,
  designWidth: 1920,
  designHeight: 1080,
  rowVersion: 1,
  schemaVersion: 1,
  isPublic: false,
  nodeCount: 4,
  createdAt: '2026-08-01T00:00:00Z',
  updatedAt: '2026-08-01T00:00:00Z',
}

function signIn(): void {
  const auth = useAuthStore()
  const permissions = [
    PERMISSION_CODES.dashboardView,
    PERMISSION_CODES.dashboardEdit,
    PERMISSION_CODES.dashboardManage,
  ]
  auth.user = {
    username: 'u',
    role: { name: 'r' },
    role_permissions: permissions,
    direct_permissions: [],
    permissions,
  } as never
  auth.accessToken = 'token'
}

async function render(projects: ProjectSummary[] = [PROJECT]) {
  vi.spyOn(dashboardApi, 'listProjects').mockResolvedValue({
    items: projects,
    page: 1,
    size: 60,
    total: projects.length,
  })
  vi.spyOn(dashboardApi, 'listDashboards').mockResolvedValue({
    items: projects.length === 0 ? [] : [DASHBOARD],
    page: 1,
    size: 60,
    total: projects.length === 0 ? 0 : 1,
  })
  const wrapper = mount(HomePage, { attachTo: document.body })
  await flushPromises()
  return wrapper
}

async function pickCardMenu(wrapper: VueWrapper, label: string): Promise<void> {
  const trigger = wrapper
    .get('[data-test="dashboard-card"]')
    .findAll('button')
    .find((button) => button.attributes('aria-haspopup') === 'menu')
  await trigger?.trigger('click')
  await flushPromises()
  ;[...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
    .find((item) => item.textContent?.includes(label) === true)
    ?.click()
  await flushPromises()
}

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  open.mockReset()
  signIn()
})

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('顶栏与工具条入口', () => {
  const CASES = [
    ['open-template-library', 'template-library'],
    ['open-runtime-params', 'runtime-params'],
    ['open-project-settings', 'project-settings'],
    ['open-import', 'import'],
    ['open-new-dashboard', 'new-dashboard'],
  ] as const

  for (const [hook, dialog] of CASES) {
    it(`${hook} 开的是 ${dialog}`, async () => {
      const wrapper = await render()
      await wrapper.get(`[data-test="${hook}"]`).trigger('click')
      expect(open).toHaveBeenCalledWith(dialog)
      wrapper.unmount()
    })
  }
})

describe('项目栏与空态入口', () => {
  it('项目栏的两个新建入口都开 new-project', async () => {
    const wrapper = await render()
    await wrapper.get('[data-test="sidebar-create-project"]').trigger('click')
    await wrapper
      .get('[data-test="sidebar-create-project-wide"]')
      .trigger('click')
    expect(open).toHaveBeenNthCalledWith(1, 'new-project')
    expect(open).toHaveBeenNthCalledWith(2, 'new-project')
    wrapper.unmount()
  })

  it('没有项目时空态里的按钮同样开 new-project', async () => {
    const wrapper = await render([])
    await wrapper.get('[data-test="empty-create-project"]').trigger('click')
    expect(open).toHaveBeenCalledWith('new-project')
    wrapper.unmount()
  })
})

describe('卡片上要弹窗的三个动作', () => {
  const CASES = [
    ['发布与分享', 'share'],
    ['另存为模板', 'save-as-template'],
    ['绑定自检', 'validate'],
  ] as const

  for (const [label, dialog] of CASES) {
    it(`「${label}」开 ${dialog}，并带上这张屏`, async () => {
      const wrapper = await render()
      await pickCardMenu(wrapper, label)
      expect(open).toHaveBeenCalledWith(dialog, DASHBOARD)
      wrapper.unmount()
    })
  }
})
