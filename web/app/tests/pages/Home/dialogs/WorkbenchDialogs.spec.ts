/**
 * @fileoverview 契约：聚合组件按 `openName` 开对弹窗，落库跑完发
 * `changed` / `select-project` / `close`，以及两条要连开两个弹窗的接力
 * （模板库 → 新建大屏、建完 → 未解析绑定）。
 *
 * ⚠ 弹窗名与 prop 名写错时 typecheck 与 lint 双双放行，只能靠这一份兜。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { PERMISSION_CODES } from '@dt/contracts'
import { useConfirm } from '@dt/ui'
import type {
  DashboardExportPayload,
  DashboardImportResult,
  DashboardPayload,
  DashboardTemplateSummary,
  Page,
} from '@dt/contracts'

import * as dashboardApi from '@/api/dashboard'
import * as templatesApi from '@/api/dashboardTemplates'
import type { DashboardSummary, ProjectSummary } from '@/api/dashboardWire'
import * as transferApi from '@/api/dashboardTransfer'
import * as themesApi from '@/api/projectThemes'
import * as runtimeApi from '@/api/runtimeParams'
import ImportFilePicker from '@/pages/Home/components/ImportFilePicker.vue'
import NewDashboardDialog from '@/pages/Home/components/NewDashboardDialog.vue'
import WorkbenchDialogs from '@/pages/Home/components/WorkbenchDialogs.vue'
import type { WorkbenchDialogName } from '@/pages/Home/dialogs'
import { useAuthStore } from '@/stores/auth'

const push = vi.fn()
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }))

const PROJECT: ProjectSummary = {
  id: 'p1',
  name: 'A 园区',
  description: null,
  themeJson: {},
  brandJson: {},
  dashboardCount: 1,
  createdAt: '2026-08-01T00:00:00Z',
  updatedAt: '2026-08-01T00:00:00Z',
}

const DASHBOARD: DashboardSummary = {
  id: 'd1',
  projectId: 'p1',
  name: '总览',
  description: null,
  designWidth: 1920,
  designHeight: 1080,
  rowVersion: 1,
  schemaVersion: 1,
  isPublic: false,
  nodeCount: 3,
  createdAt: '2026-08-01T00:00:00Z',
  updatedAt: '2026-08-01T00:00:00Z',
}

const TEMPLATE: DashboardTemplateSummary = {
  id: 't1',
  name: '光伏模板',
  description: null,
  category: null,
  thumbnail: null,
  sourceProjectId: null,
  createdAt: '2026-08-01T00:00:00Z',
  updatedAt: '2026-08-01T00:00:00Z',
}

function payload(name: string): DashboardPayload {
  return {
    id: 'd9',
    projectId: 'p1',
    name,
    description: null,
    designWidth: 1920,
    designHeight: 1080,
    themeJson: {},
    chromeJson: {},
    rowVersion: 1,
    schemaVersion: 1,
    isPublic: false,
    publicToken: null,
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
    nodes: [],
  }
}

function withDangling(name: string): DashboardImportResult {
  return {
    ...payload(name),
    unresolvedBindings: [
      {
        nodeKey: 's1:PV.P',
        fieldKey: 'value',
        sourceKind: 'opcua',
        reason: '点位不存在',
      },
    ],
  }
}

function templatePage(): Page<DashboardTemplateSummary> {
  return { items: [TEMPLATE], total: 1, page: 1, size: 100 }
}

const EMPTY_PACKAGE: DashboardExportPayload = {
  schemaVersion: 1,
  name: '光伏总览',
  description: null,
  designWidth: 1920,
  designHeight: 1080,
  themeJson: {},
  chromeJson: {},
  nodes: [],
}

/** 存盘的文件是线形的（snake_case），与后端导出的那份同形。 */
function exportFile(): File {
  const wire = {
    schema_version: 1,
    name: '光伏总览',
    description: null,
    design_width: 1920,
    design_height: 1080,
    theme_json: {},
    chrome_json: {},
    nodes: [],
  }
  return new File([JSON.stringify(wire)], 'x.json')
}

function mountDialogs(openName: WorkbenchDialogName | null) {
  return mount(WorkbenchDialogs, {
    props: {
      openName,
      target: DASHBOARD,
      projects: [PROJECT],
      selectedProjectId: 'p1',
      dashboards: [DASHBOARD],
    },
    global: { stubs: { Teleport: true } },
  })
}

function signIn(codes: readonly string[]): void {
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

async function clickText(
  wrapper: ReturnType<typeof mountDialogs>,
  label: string,
): Promise<void> {
  const hit = wrapper
    .findAll('button')
    .find((button) => button.text().includes(label))
  expect(hit, `没有文案含「${label}」的按钮`).toBeDefined()
  await hit?.trigger('click')
}

beforeEach(() => {
  setActivePinia(createPinia())
  push.mockReset()
  signIn([
    PERMISSION_CODES.dashboardView,
    PERMISSION_CODES.dashboardEdit,
    PERMISSION_CODES.dashboardManage,
  ])
  vi.spyOn(themesApi, 'listProjectThemes').mockResolvedValue([])
  vi.spyOn(runtimeApi, 'listRuntimeParams').mockResolvedValue([])
  vi.spyOn(templatesApi, 'listDashboardTemplates').mockResolvedValue(
    templatePage(),
  )
  vi.spyOn(dashboardApi, 'validateDashboard').mockResolvedValue({
    dashboardId: 'd1',
    isValid: true,
    issues: [],
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('新建项目', () => {
  it('建成后依次发 changed / select-project / close', async () => {
    vi.spyOn(dashboardApi, 'createProject').mockResolvedValue({
      ...PROJECT,
      id: 'p9',
      name: '新项目',
    })
    const wrapper = mountDialogs('new-project')
    await wrapper.find('input').setValue('新项目')

    await clickText(wrapper, '创建项目')
    await flushPromises()

    expect(wrapper.emitted('changed')).toEqual([['projects']])
    expect(wrapper.emitted('select-project')).toEqual([['p9']])
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('建失败时既不通知重拉也不关弹窗', async () => {
    vi.spyOn(dashboardApi, 'createProject').mockRejectedValue(new Error('炸了'))
    const wrapper = mountDialogs('new-project')
    await wrapper.find('input').setValue('新项目')

    await clickText(wrapper, '创建项目')
    await flushPromises()

    expect(wrapper.emitted('changed')).toBeUndefined()
    expect(wrapper.emitted('close')).toBeUndefined()
  })
})

describe('模板库到新建大屏的接力', () => {
  it('点一张模板会关掉模板库并把新建大屏顶上来，且预选了这张模板', async () => {
    const wrapper = mountDialogs('template-library')
    await flushPromises()

    await clickText(wrapper, '光伏模板')
    await flushPromises()

    expect(wrapper.emitted('close')).toHaveLength(1)
    expect(wrapper.text()).toContain('新建大屏')
    expect(wrapper.text()).toContain('把模板实例化成新屏')
  })

  it('没有建屏权限时只提示，不把新建大屏顶上来', async () => {
    signIn([PERMISSION_CODES.dashboardView])
    const wrapper = mountDialogs('template-library')
    await flushPromises()

    await clickText(wrapper, '光伏模板')
    await flushPromises()

    expect(wrapper.text()).not.toContain('把模板实例化成新屏')
    expect(wrapper.emitted('close')).toBeUndefined()
  })
})

describe('建屏与未解析绑定的接力', () => {
  it('建出来的屏有绑定没接上时，接着弹未解析绑定', async () => {
    vi.spyOn(templatesApi, 'instantiateDashboardTemplate').mockResolvedValue(
      withDangling('模板屏'),
    )
    const wrapper = mountDialogs('template-library')
    await flushPromises()
    await clickText(wrapper, '光伏模板')
    await flushPromises()

    await clickText(wrapper, '创建大屏')
    await flushPromises()

    expect(wrapper.emitted('changed')).toEqual([['dashboards']])
    expect(wrapper.text()).toContain('有 1 条绑定')
  })

  it('去预览跳到新建出来的那张屏', async () => {
    vi.spyOn(templatesApi, 'instantiateDashboardTemplate').mockResolvedValue(
      withDangling('模板屏'),
    )
    const wrapper = mountDialogs('template-library')
    await flushPromises()
    await clickText(wrapper, '光伏模板')
    await flushPromises()
    await clickText(wrapper, '创建大屏')
    await flushPromises()

    await clickText(wrapper, '去预览')

    expect(push).toHaveBeenCalledWith({
      name: 'dashboard-view',
      params: { dashboardId: 'd9' },
    })
  })

  it('全部接上时不弹未解析绑定', async () => {
    vi.spyOn(dashboardApi, 'createDashboard').mockResolvedValue(payload('空屏'))
    const wrapper = mountDialogs('new-dashboard')
    await wrapper.findAll('input')[0]?.setValue('空屏')

    await clickText(wrapper, '创建大屏')
    await flushPromises()

    expect(wrapper.text()).not.toContain('有 1 条绑定')
  })
})

describe('复制来源跨项目', () => {
  it('开新建大屏时拉一次全量，别的项目的屏也能当复制来源', async () => {
    const other: DashboardSummary = {
      ...DASHBOARD,
      id: 'd2',
      projectId: 'p2',
      name: 'B 园区的屏',
    }
    vi.spyOn(dashboardApi, 'listDashboards').mockResolvedValue({
      items: [DASHBOARD, other],
      total: 2,
      page: 1,
      size: 200,
    })
    const wrapper = mountDialogs('new-dashboard')
    await flushPromises()

    expect(dashboardApi.listDashboards).toHaveBeenCalledWith({ size: 200 })
    expect(
      wrapper.getComponent(NewDashboardDialog).props('dashboardsByProject'),
    ).toMatchObject({ p1: [DASHBOARD], p2: [other] })
  })

  it('拉不到时退回页面已有的那份，而不是给个空列表', async () => {
    vi.spyOn(dashboardApi, 'listDashboards').mockRejectedValue(
      new Error('炸了'),
    )
    const wrapper = mountDialogs('new-dashboard')
    await flushPromises()

    expect(
      wrapper.getComponent(NewDashboardDialog).props('dashboardsByProject'),
    ).toMatchObject({ p1: [DASHBOARD] })
  })
})

describe('自定义主题在开设置时才拉', () => {
  it('开项目设置才拉一次，别的弹窗不拉', async () => {
    mountDialogs('project-settings')
    await flushPromises()
    expect(themesApi.listProjectThemes).toHaveBeenCalledWith('p1')

    vi.mocked(themesApi.listProjectThemes).mockClear()
    mountDialogs('new-project')
    await flushPromises()

    expect(themesApi.listProjectThemes).not.toHaveBeenCalled()
  })
})

describe('项目设置', () => {
  it('保存打的是当前选中项目，成功后通知重拉项目并关窗', async () => {
    const spy = vi
      .spyOn(dashboardApi, 'updateProject')
      .mockResolvedValue(PROJECT)
    const wrapper = mountDialogs('project-settings')
    await flushPromises()

    await clickText(wrapper, '保存设置')
    await flushPromises()

    expect(spy).toHaveBeenCalledWith('p1', {
      name: 'A 园区',
      description: '',
      themeJson: {},
      brandJson: {},
    })
    expect(wrapper.emitted('changed')).toEqual([['projects']])
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('删项目先问一遍，答不删就不发请求', async () => {
    const spy = vi.spyOn(dashboardApi, 'deleteProject').mockResolvedValue()
    const wrapper = mountDialogs('project-settings')
    await flushPromises()

    await clickText(wrapper, '删除项目')
    useConfirm().resolve(false)
    await flushPromises()

    expect(spy).not.toHaveBeenCalled()
  })

  it('答应删了才删，删完通知重拉项目', async () => {
    const spy = vi.spyOn(dashboardApi, 'deleteProject').mockResolvedValue()
    const wrapper = mountDialogs('project-settings')
    await flushPromises()

    await clickText(wrapper, '删除项目')
    useConfirm().resolve(true)
    await flushPromises()

    expect(spy).toHaveBeenCalledWith('p1')
    expect(wrapper.emitted('changed')).toEqual([['projects']])
  })

  it('新建一套主题会落到当前项目下，并整组重拉一次', async () => {
    const spy = vi
      .spyOn(themesApi, 'createProjectTheme')
      .mockResolvedValue({ id: 'c1', name: '蓝', mode: 'dark', tokens: {} })
    const wrapper = mountDialogs('project-settings')
    await flushPromises()

    await clickText(wrapper, '主题')
    await clickText(wrapper, '新建主题')
    await wrapper.find('input[placeholder="主题名称"]').setValue('蓝')
    await clickText(wrapper, '创建')
    await flushPromises()

    expect(spy.mock.calls[0]?.[0]).toBe('p1')
    expect(themesApi.listProjectThemes).toHaveBeenCalledTimes(2)
  })
})

describe('模板的两个写操作', () => {
  it('另存为模板打的是当前这张屏，成功后关窗', async () => {
    const spy = vi
      .spyOn(templatesApi, 'createDashboardTemplate')
      .mockResolvedValue({ ...TEMPLATE, payload: EMPTY_PACKAGE })
    const wrapper = mountDialogs('save-as-template')

    await clickText(wrapper, '保存模板')
    await flushPromises()

    expect(spy).toHaveBeenCalledWith({
      sourceDashboardId: 'd1',
      name: '总览 模板',
      category: undefined,
      description: undefined,
    })
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('删模板先问一遍，答应了才删并重拉模板库', async () => {
    const spy = vi
      .spyOn(templatesApi, 'deleteDashboardTemplate')
      .mockResolvedValue()
    const wrapper = mountDialogs('template-library')
    await flushPromises()

    await wrapper.find('[aria-label="删除模板"]').trigger('click')
    useConfirm().resolve(true)
    await flushPromises()

    expect(spy).toHaveBeenCalledWith('t1')
    expect(templatesApi.listDashboardTemplates).toHaveBeenCalledTimes(2)
  })
})

describe('导入的两步', () => {
  it('选完文件才把导入确认框顶上来，并摆出包里的名字', async () => {
    const wrapper = mountDialogs('import')
    expect(wrapper.text()).toContain('先选一份导出的 JSON')

    wrapper.getComponent(ImportFilePicker).vm.$emit('pick', exportFile())
    await flushPromises()

    expect(wrapper.text()).toContain('光伏总览')
    expect(wrapper.text()).toContain('导入后的名称')
  })

  it('确认后打导入端点，成功则通知重拉大屏并关窗', async () => {
    const spy = vi
      .spyOn(transferApi, 'importDashboard')
      .mockResolvedValue({ ...payload('光伏总览'), unresolvedBindings: [] })
    const wrapper = mountDialogs('import')
    wrapper.getComponent(ImportFilePicker).vm.$emit('pick', exportFile())
    await flushPromises()

    await clickText(wrapper, '导入')
    await flushPromises()

    expect(spy.mock.calls[0]?.[0]).toMatchObject({
      projectId: 'p1',
      newName: '光伏总览',
    })
    expect(wrapper.emitted('changed')).toEqual([['dashboards']])
    expect(wrapper.emitted('close')).toHaveLength(1)
  })
})

describe('关闭', () => {
  it('弹窗自己要关时把 close 转出去', async () => {
    const wrapper = mountDialogs('new-project')

    await clickText(wrapper, '取消')

    expect(wrapper.emitted('close')).toHaveLength(1)
  })
})
