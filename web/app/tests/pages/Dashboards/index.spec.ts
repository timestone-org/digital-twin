/**
 * @fileoverview 契约：大屏列表能新建 / 改名 / 删除 / 进编辑器，
 * 且**没有项目时把创建挡住并说清原因**——大屏必须挂在项目下，
 * 让创建键点下去收一个 422 是把校验推给了用户。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import type { Page } from '@dt/contracts'

import * as dashboardApi from '@/api/dashboard'
import type { DashboardSummary, ProjectSummary } from '@/api/dashboardWire'
import Dashboards from '@/pages/Dashboards/index.vue'
import { useAuthStore } from '@/stores/auth'

vi.mock('vue-router', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useRoute: () => ({ path: '/dashboards', query: {} }),
  RouterLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
}))

interface ConfirmAsk {
  title: string
  message: string
  confirmText?: string
  danger?: boolean
}
const confirmSpy = vi.fn<(request: ConfirmAsk) => Promise<boolean>>()
vi.mock('@dt/ui', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@dt/ui')
  return {
    ...actual,
    useConfirm: () => ({ ask: confirmSpy }),
    useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
  }
})

function summary(over: Partial<DashboardSummary> = {}): DashboardSummary {
  return {
    id: 'db1',
    projectId: 'p1',
    name: '一号大屏',
    description: null,
    designWidth: 1920,
    designHeight: 1080,
    rowVersion: 3,
    schemaVersion: 1,
    isPublic: false,
    nodeCount: 4,
    createdAt: '',
    updatedAt: '',
    ...over,
  }
}

function project(): ProjectSummary {
  return {
    id: 'p1',
    name: '默认项目',
    description: null,
    themeJson: {},
    brandJson: {},
    dashboardCount: 1,
    createdAt: '',
    updatedAt: '',
  }
}

function page<T>(items: T[]): Page<T> {
  return { items, total: items.length, page: 1, size: 20 }
}

function signIn(codes: string[]): void {
  const auth = useAuthStore()
  auth.accessToken = 'token'
  auth.user = { permissions: codes } as never
}

const ROUTER_LINK = { props: ['to'], template: '<a :href="to"><slot /></a>' }

async function mountPage() {
  const wrapper = mount(Dashboards, {
    global: { stubs: { Teleport: true, RouterLink: ROUTER_LINK } },
  })
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  setActivePinia(createPinia())
  confirmSpy.mockReset()
  confirmSpy.mockResolvedValue(false)
  signIn(['dashboard:view', 'dashboard:edit'])
  vi.spyOn(dashboardApi, 'listProjects').mockResolvedValue(page([project()]))
  vi.spyOn(dashboardApi, 'listDashboards').mockResolvedValue(
    page([summary()]),
  )
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('列表', () => {
  it('列出大屏的名称、尺寸、节点数与版本', async () => {
    const wrapper = await mountPage()

    expect(wrapper.text()).toContain('一号大屏')
    expect(wrapper.text()).toContain('1920 × 1080')
    expect(wrapper.text()).toContain('v3')
  })

  it('取数失败时把原因显示出来', async () => {
    vi.spyOn(dashboardApi, 'listProjects').mockRejectedValue(
      new Error('项目服务不可达'),
    )
    const wrapper = await mountPage()

    expect(wrapper.text()).toContain('项目列表没取到')
  })
})

describe('没有项目时', () => {
  it('说清「大屏必须挂在项目下」并禁用新建', async () => {
    vi.spyOn(dashboardApi, 'listProjects').mockResolvedValue(page([]))
    const wrapper = await mountPage()
    const create = wrapper
      .findAll('button')
      .find((item) => item.text().includes('新建大屏'))

    expect(wrapper.text()).toContain('大屏必须挂在项目下')
    expect(create?.attributes('disabled')).toBeDefined()
  })
})

describe('写操作', () => {
  it('新建把项目 id 一起带上', async () => {
    const create = vi
      .spyOn(dashboardApi, 'createDashboard')
      .mockResolvedValue({} as never)
    const wrapper = await mountPage()
    await wrapper
      .findAll('button')
      .find((item) => item.text().includes('新建大屏'))
      ?.trigger('click')
    // ⚠ 取最后一个：第一个是工具条上的搜索框，弹窗里的名称框排在它后面
    await wrapper.findAll('.dt-input__el').at(-1)?.setValue('新大屏')
    await wrapper
      .findAll('button')
      .find((item) => item.text().trim() === '创建')
      ?.trigger('click')
    await flushPromises()

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ name: '新大屏', projectId: 'p1' }),
    )
  })

  it('重命名只改名字，不碰设计尺寸', async () => {
    const update = vi
      .spyOn(dashboardApi, 'updateDashboard')
      .mockResolvedValue({} as never)
    const wrapper = await mountPage()
    await wrapper
      .findAll('button')
      .find((item) => item.text().includes('重命名'))
      ?.trigger('click')
    await wrapper.findAll('.dt-input__el').at(-1)?.setValue('改过的名字')
    await wrapper
      .findAll('button')
      .find((item) => item.text().trim() === '保存')
      ?.trigger('click')
    await flushPromises()

    expect(update).toHaveBeenCalledWith('db1', { name: '改过的名字' })
  })

  it('删除前先二次确认，确认文案里写清会连节点一起删', async () => {
    const remove = vi.spyOn(dashboardApi, 'deleteDashboard')
    const wrapper = await mountPage()

    await wrapper
      .findAll('button')
      .find((item) => item.text().trim() === '删除')
      ?.trigger('click')
    await flushPromises()

    expect(confirmSpy.mock.calls[0]?.[0]).toMatchObject({
      title: '删除大屏',
      danger: true,
    })
    expect(confirmSpy.mock.calls[0]?.[0].message).toContain('4 个节点')
    expect(remove).not.toHaveBeenCalled()
  })

  it('确认之后才真的删', async () => {
    confirmSpy.mockResolvedValue(true)
    const remove = vi
      .spyOn(dashboardApi, 'deleteDashboard')
      .mockResolvedValue(undefined)
    const wrapper = await mountPage()

    await wrapper
      .findAll('button')
      .find((item) => item.text().trim() === '删除')
      ?.trigger('click')
    await flushPromises()

    expect(remove).toHaveBeenCalledWith('db1')
  })
})
