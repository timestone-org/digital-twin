/**
 * @fileoverview 工作台的行为契约。最要紧的三条不是渲染对不对：
 * 没有 `dashboard:view` 时必须一个请求都不发、只给空态（这一页是路由守卫的
 * 兜底目的地，落成错误态会让只管账号的角色一进系统就撞上一片红）；
 * 切项目必须防竞态；选中的项目要跨挂载记得住。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { PERMISSION_CODES } from '@dt/contracts'
import type { Page } from '@dt/contracts'

import * as dashboardApi from '@/api/dashboard'
import { listDashboardTemplates } from '@/api/dashboardTemplates'
import { listRuntimeParams } from '@/api/runtimeParams'
import * as transferApi from '@/api/dashboardTransfer'
import type { DashboardSummary, ProjectSummary } from '@/api/dashboardWire'
import { STORAGE_KEYS } from '@/config/storage'
import HomePage from '@/pages/Home/index.vue'
import NewProjectDialog from '@/pages/Home/components/NewProjectDialog.vue'
import TemplateLibraryDialog from '@/pages/Home/components/TemplateLibraryDialog.vue'
import WorkbenchDialogs from '@/pages/Home/components/WorkbenchDialogs.vue'
import { useAuthStore } from '@/stores/auth'

vi.mock('@/api/dashboardTemplates', () => ({
  listDashboardTemplates: vi.fn(),
  createDashboardTemplate: vi.fn(),
  deleteDashboardTemplate: vi.fn(),
  instantiateDashboardTemplate: vi.fn(),
}))

const downloadJson = vi.fn()
vi.mock('@/utils/downloadJson', () => ({
  downloadJson: (data: unknown, name: string): void => {
    downloadJson(data, name)
  },
  toFileName: (name: string): string => name,
}))

const push = vi.fn()
vi.mock('vue-router', () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  useRoute: () => ({ path: '/', query: {} }),
  RouterLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
}))

vi.mock('@/api/dashboardThumbnail', () => ({
  getDashboardThumbnail: vi.fn().mockResolvedValue(null),
}))

// ⚠ 运行参数弹窗一打开就取数。不打桩的话这条用例会**真的发一次请求**——
// happy-dom 里它只是安静地失败成一行 stderr，用例照样绿，但 CI 上就是一次
// 真出网：慢、看网络脸色、且把「没打桩」这件事一直藏着
vi.mock('@/api/runtimeParams', () => ({
  listRuntimeParams: vi.fn(),
  saveRuntimeParams: vi.fn(),
  resetRuntimeParams: vi.fn(),
}))

const confirmSpy = vi.fn<() => Promise<boolean>>()
const toastError = vi.fn()
vi.mock('@dt/ui', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@dt/ui')
  return {
    ...actual,
    useConfirm: () => ({ ask: confirmSpy }),
    useToast: () => ({
      success: vi.fn(),
      error: toastError,
      info: vi.fn(),
      warning: vi.fn(),
    }),
  }
})

const ALL_CODES = [
  PERMISSION_CODES.dashboardView,
  PERMISSION_CODES.dashboardEdit,
  PERMISSION_CODES.dashboardManage,
]

function project(over: Partial<ProjectSummary> = {}): ProjectSummary {
  return {
    id: 'p-1',
    name: '一号厂区',
    description: null,
    themeJson: {},
    brandJson: {},
    dashboardCount: 2,
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
    ...over,
  }
}

function dashboard(over: Partial<DashboardSummary> = {}): DashboardSummary {
  return {
    id: 'd-1',
    projectId: 'p-1',
    name: '产线总览',
    description: null,
    designWidth: 1920,
    designHeight: 1080,
    rowVersion: 3,
    schemaVersion: 1,
    isPublic: false,
    nodeCount: 12,
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
    ...over,
  }
}

function pageOf<T>(items: T[], total = items.length): Page<T> {
  return { items, page: 1, size: 60, total }
}

/**
 * ⚠ 出参必须每条用例重新给：`vi.restoreAllMocks()` 会把工厂里 `vi.fn()` 的实现
 * 一起清掉，只在工厂里写 `mockResolvedValue` 的话，第二条用例起这两个接口就回
 * `undefined`，弹窗里 `rows.find(...)` 当场炸，而用例本身照样绿。
 */
function stubDialogApis(): void {
  vi.mocked(listRuntimeParams).mockResolvedValue([])
  vi.mocked(listDashboardTemplates).mockResolvedValue({
    items: [],
    page: 1,
    size: 20,
    total: 0,
  })
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

const PROJECTS = [
  project(),
  project({ id: 'p-2', name: '二号厂区', dashboardCount: 1 }),
]

function stubList(
  projects: ProjectSummary[] = PROJECTS,
  dashboards: DashboardSummary[] = [dashboard()],
): void {
  vi.spyOn(dashboardApi, 'listProjects').mockResolvedValue(pageOf(projects))
  vi.spyOn(dashboardApi, 'listDashboards').mockResolvedValue(pageOf(dashboards))
}

async function render(): Promise<VueWrapper> {
  const wrapper = mount(HomePage, { attachTo: document.body })
  await flushPromises()
  return wrapper
}

function projectRows(wrapper: VueWrapper) {
  return wrapper.findAll('[data-test="project-row"]')
}

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  push.mockReset()
  toastError.mockReset()
  downloadJson.mockReset()
  confirmSpy.mockReset().mockResolvedValue(true)
  stubDialogApis()
  signIn(ALL_CODES)
})

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('取数与渲染', () => {
  it('左边列项目、右边列当前项目的大屏', async () => {
    stubList()
    const wrapper = await render()
    expect(wrapper.text()).toContain('一号厂区')
    expect(wrapper.text()).toContain('二号厂区')
    expect(wrapper.text()).toContain('产线总览')
  })

  it('大屏只按当前项目拉', async () => {
    stubList()
    await render()
    expect(dashboardApi.listDashboards).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'p-1' }),
    )
  })

  it('列表被截断时把「还有多少没列出来」说出来', async () => {
    vi.spyOn(dashboardApi, 'listProjects').mockResolvedValue(pageOf(PROJECTS))
    vi.spyOn(dashboardApi, 'listDashboards').mockResolvedValue(
      pageOf([dashboard()], 120),
    )
    expect((await render()).text()).toContain('已列出前 1 个')
  })

  it('取数失败给错误态与重试入口', async () => {
    vi.spyOn(dashboardApi, 'listProjects').mockRejectedValue(
      new Error('后端挂了'),
    )
    vi.spyOn(dashboardApi, 'listDashboards').mockResolvedValue(pageOf([]))
    const wrapper = await render()
    expect(wrapper.text()).toContain('加载失败')

    vi.spyOn(dashboardApi, 'listProjects').mockResolvedValue(pageOf(PROJECTS))
    const retry = wrapper
      .findAll('button')
      .find((button) => button.text() === '重试')
    await retry?.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('一号厂区')
  })

  it('一个项目都没有时给空态与新建项目入口', async () => {
    stubList([], [])
    const wrapper = await render()
    expect(wrapper.get('[data-test="no-projects"]').text()).toContain(
      '还没有任何项目',
    )
    expect(wrapper.find('[data-test="empty-create-project"]').exists()).toBe(
      true,
    )
  })

  it('项目下没有大屏时给空态', async () => {
    stubList(PROJECTS, [])
    expect((await render()).text()).toContain('还没有大屏')
  })
})

describe('没有查看权限', () => {
  it('一个请求都不发', async () => {
    signIn([])
    stubList()
    await render()
    expect(dashboardApi.listProjects).not.toHaveBeenCalled()
    expect(dashboardApi.listDashboards).not.toHaveBeenCalled()
  })

  it('给的是空态不是错误态', async () => {
    signIn([])
    stubList()
    const wrapper = await render()
    expect(wrapper.get('[data-test="no-view-permission"]').text()).toContain(
      '没有大屏查看权限',
    )
    expect(wrapper.text()).not.toContain('加载失败')
  })

  it('连项目栏都不画', async () => {
    signIn([])
    stubList()
    expect(projectRows(await render())).toHaveLength(0)
  })
})

describe('切项目', () => {
  it('慢的那次后返回也不许盖掉快的那次', async () => {
    vi.spyOn(dashboardApi, 'listProjects').mockResolvedValue(pageOf(PROJECTS))
    const settlers: Array<(page: Page<DashboardSummary>) => void> = []
    vi.spyOn(dashboardApi, 'listDashboards').mockImplementation(
      () =>
        new Promise<Page<DashboardSummary>>((resolve) => {
          settlers.push(resolve)
        }),
    )

    const wrapper = mount(HomePage)
    await flushPromises()
    await projectRows(wrapper)[1]?.trigger('click')
    await flushPromises()

    // 后发的先回，先发的后回：界面上必须留着后发那次的结果
    settlers[1]?.(pageOf([dashboard({ id: 'd-2', name: '二号屏' })]))
    await flushPromises()
    settlers[0]?.(pageOf([dashboard({ id: 'd-1', name: '一号屏' })]))
    await flushPromises()

    expect(wrapper.text()).toContain('二号屏')
    expect(wrapper.text()).not.toContain('一号屏')
  })

  it('选中的项目写进 localStorage', async () => {
    stubList()
    const wrapper = await render()
    await projectRows(wrapper)[1]?.trigger('click')
    await flushPromises()
    expect(localStorage.getItem(STORAGE_KEYS.lastProject)).toBe('p-2')
  })

  it('重新挂载沿用上次选中的项目', async () => {
    localStorage.setItem(STORAGE_KEYS.lastProject, 'p-2')
    stubList()
    await render()
    expect(dashboardApi.listDashboards).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'p-2' }),
    )
  })

  it('记着的项目已经不在了就回落到第一个', async () => {
    localStorage.setItem(STORAGE_KEYS.lastProject, 'p-gone')
    stubList()
    await render()
    expect(dashboardApi.listDashboards).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'p-1' }),
    )
  })
})

describe('搜索', () => {
  it('只留名字匹配的大屏', async () => {
    stubList(PROJECTS, [
      dashboard({ id: 'd-1', name: '产线总览' }),
      dashboard({ id: 'd-2', name: '能耗看板' }),
    ])
    const wrapper = await render()
    await wrapper.get('[data-test="dashboard-search"]').setValue('能耗')
    await flushPromises()
    expect(wrapper.text()).toContain('能耗看板')
    expect(wrapper.text()).not.toContain('产线总览')
  })

  it('搜不到时说清是搜索没命中，不是这个项目空了', async () => {
    stubList()
    const wrapper = await render()
    await wrapper.get('[data-test="dashboard-search"]').setValue('查无此屏')
    await flushPromises()
    expect(wrapper.text()).toContain('没有匹配的大屏')
  })
})

describe('顶栏与工具条入口', () => {
  const ENTRIES = [
    'open-template-library',
    'open-runtime-params',
    'open-project-settings',
    'open-import',
    'open-new-dashboard',
  ] as const

  it('五个入口都在', async () => {
    stubList()
    const wrapper = await render()
    for (const entry of ENTRIES) {
      expect(wrapper.find(`[data-test="${entry}"]`).exists()).toBe(true)
    }
  })

  it('点模板库把弹窗开关翻过去', async () => {
    stubList()
    const wrapper = await render()
    const button = wrapper.get('[data-test="open-template-library"]')
    expect(button.attributes('aria-expanded')).toBe('false')
    await button.trigger('click')
    expect(button.attributes('aria-expanded')).toBe('true')
  })

  it('点运行参数把弹窗开关翻过去', async () => {
    stubList()
    const wrapper = await render()
    const button = wrapper.get('[data-test="open-runtime-params"]')
    await button.trigger('click')
    expect(button.attributes('aria-expanded')).toBe('true')
  })

  // ⚠ 点了之后弹窗要真的在 DOM 里：入口按钮与弹窗之间断一环，两道闸都不会响
  it('点模板库，模板库弹窗真的开了', async () => {
    stubList()
    const wrapper = await render()
    await wrapper.get('[data-test="open-template-library"]').trigger('click')
    await flushPromises()
    expect(wrapper.getComponent(TemplateLibraryDialog).props('open')).toBe(true)
  })

  it('点侧栏的新建项目，新建项目弹窗真的开了', async () => {
    stubList()
    const wrapper = await render()
    await wrapper.get('[data-test="sidebar-create-project"]').trigger('click')
    await flushPromises()
    expect(wrapper.getComponent(NewProjectDialog).props('open')).toBe(true)
  })

  it('只有读权限时建屏与导入的入口都不画', async () => {
    signIn([PERMISSION_CODES.dashboardView])
    stubList()
    const wrapper = await render()
    expect(wrapper.find('[data-test="open-new-dashboard"]').exists()).toBe(
      false,
    )
    expect(wrapper.find('[data-test="open-import"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="open-template-library"]').exists()).toBe(
      true,
    )
  })
})

describe('项目重命名', () => {
  it('提交后写库并重拉项目列表', async () => {
    stubList()
    const update = vi
      .spyOn(dashboardApi, 'updateProject')
      .mockResolvedValue(project({ name: '新厂区' }))
    const wrapper = await render()

    await projectRows(wrapper)[0]
      ?.get('[data-test="project-rename"]')
      .trigger('click')
    const field = wrapper.get('[data-test="inline-rename"]')
    await field.setValue('新厂区')
    await field.trigger('keydown', { key: 'Enter' })
    await flushPromises()

    expect(update).toHaveBeenCalledWith('p-1', { name: '新厂区' })
    expect(dashboardApi.listProjects).toHaveBeenCalledTimes(2)
  })

  it('写库失败时报错，不静默吞掉', async () => {
    stubList()
    vi.spyOn(dashboardApi, 'updateProject').mockRejectedValue(
      new Error('没权限'),
    )
    const wrapper = await render()
    await projectRows(wrapper)[0]
      ?.get('[data-test="project-rename"]')
      .trigger('click')
    const field = wrapper.get('[data-test="inline-rename"]')
    await field.setValue('新厂区')
    await field.trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(toastError).toHaveBeenCalled()
  })
})

describe('弹窗回来的三条信号', () => {
  it('改了大屏只重拉大屏', async () => {
    stubList()
    const wrapper = await render()
    wrapper.getComponent(WorkbenchDialogs).vm.$emit('changed', 'dashboards')
    await flushPromises()
    expect(dashboardApi.listDashboards).toHaveBeenCalledTimes(2)
    expect(dashboardApi.listProjects).toHaveBeenCalledTimes(1)
  })

  it('改了项目连大屏一起重拉——删掉当前项目后网格不能还留着它的屏', async () => {
    stubList()
    const wrapper = await render()
    wrapper.getComponent(WorkbenchDialogs).vm.$emit('changed', 'projects')
    await flushPromises()
    expect(dashboardApi.listProjects).toHaveBeenCalledTimes(2)
    expect(dashboardApi.listDashboards).toHaveBeenCalledTimes(2)
  })

  it('select-project 切到新项目并拉它的大屏', async () => {
    stubList()
    const wrapper = await render()
    wrapper.getComponent(WorkbenchDialogs).vm.$emit('select-project', 'p-2')
    await flushPromises()
    expect(dashboardApi.listDashboards).toHaveBeenLastCalledWith(
      expect.objectContaining({ projectId: 'p-2' }),
    )
  })

  it('close 把开着的弹窗关掉', async () => {
    stubList()
    const wrapper = await render()
    const button = wrapper.get('[data-test="open-template-library"]')
    await button.trigger('click')
    expect(button.attributes('aria-expanded')).toBe('true')

    wrapper.getComponent(WorkbenchDialogs).vm.$emit('close')
    await flushPromises()
    expect(button.attributes('aria-expanded')).toBe('false')
  })
})

describe('卡片动作接线', () => {
  /**
   * ⚠ 触发器必须在卡片里找：顶栏的主题切换器也是 `aria-haspopup="menu"`，
   * 在整页范围内取第一个会开错那个浮层，而两边都不报错。
   */
  async function pickMenu(wrapper: VueWrapper, label: string): Promise<void> {
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

  it('预览跳到大屏运行页', async () => {
    stubList()
    const wrapper = await render()
    await wrapper.get('[data-test="card-preview"]').trigger('click')
    expect(push).toHaveBeenCalledWith({
      name: 'dashboard-view',
      params: { dashboardId: 'd-1' },
    })
  })

  it('编辑跳到编辑器', async () => {
    stubList()
    const wrapper = await render()
    await wrapper.get('[data-test="card-edit"]').trigger('click')
    expect(push).toHaveBeenCalledWith({
      name: 'dashboard-editor',
      params: { dashboardId: 'd-1' },
    })
  })

  it('创建副本调复制端点并重拉列表', async () => {
    stubList()
    const duplicate = vi
      .spyOn(transferApi, 'duplicateDashboard')
      .mockResolvedValue({ name: '产线总览 副本' } as never)
    const wrapper = await render()
    await pickMenu(wrapper, '创建副本')
    expect(duplicate).toHaveBeenCalledWith('d-1')
    expect(dashboardApi.listDashboards).toHaveBeenCalledTimes(2)
  })

  it('删除先二次确认再落库', async () => {
    stubList()
    const remove = vi
      .spyOn(dashboardApi, 'deleteDashboard')
      .mockResolvedValue(undefined)
    const wrapper = await render()
    await pickMenu(wrapper, '删除')
    expect(confirmSpy).toHaveBeenCalled()
    expect(remove).toHaveBeenCalledWith('d-1')
  })

  it('确认框点了取消就不删', async () => {
    stubList()
    confirmSpy.mockResolvedValue(false)
    const remove = vi
      .spyOn(dashboardApi, 'deleteDashboard')
      .mockResolvedValue(undefined)
    const wrapper = await render()
    await pickMenu(wrapper, '删除')
    expect(remove).not.toHaveBeenCalled()
  })

  it('卡片重命名写库', async () => {
    stubList()
    const update = vi
      .spyOn(dashboardApi, 'updateDashboard')
      .mockResolvedValue({ name: '新屏名' } as never)
    const wrapper = await render()
    await pickMenu(wrapper, '重命名')
    const field = wrapper.get('[data-test="inline-rename"]')
    await field.setValue('新屏名')
    await field.trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(update).toHaveBeenCalledWith('d-1', { name: '新屏名' })
  })

  it('导出存盘的是线形 snake_case，不是内存里的 camelCase', async () => {
    stubList()
    vi.spyOn(transferApi, 'exportDashboard').mockResolvedValue({
      schemaVersion: 1,
      name: '产线总览',
      description: null,
      designWidth: 1920,
      designHeight: 1080,
      themeJson: {},
      chromeJson: {},
      nodes: [],
    })
    const wrapper = await render()
    await pickMenu(wrapper, '导出 JSON')

    // ⚠ 存 camelCase 的包导回来会被 parseExportPackage 判成形状不对，
    // 而那时候用户手里已经只剩这一份文件了
    const [data] = downloadJson.mock.calls[0] ?? []
    expect(data).toMatchObject({
      schema_version: 1,
      design_width: 1920,
      design_height: 1080,
    })
    expect(data).not.toHaveProperty('designWidth')
  })

  it('导出失败时报错而不是静默无事发生', async () => {
    stubList()
    vi.spyOn(transferApi, 'exportDashboard').mockRejectedValue(
      new Error('导出炸了'),
    )
    const wrapper = await render()
    await pickMenu(wrapper, '导出 JSON')
    expect(toastError).toHaveBeenCalled()
  })
})
