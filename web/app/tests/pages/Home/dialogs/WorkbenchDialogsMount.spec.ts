/**
 * @fileoverview 挂载点契约：`openName` 是哪个值，就只有对应的那一个弹窗是开着的。
 *
 * ⚠ 这一条是防「挂载点被弄丢」的唯一防线：少挂一个弹窗、或者把 `:open` 接到
 * 另一个名字上，typecheck 与 lint 双双放行，表现只是按钮点下去没反应。
 * 断言用组件实例而不是标题文案：文案会改，挂没挂上不该跟着文案一起漂。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { PERMISSION_CODES } from '@dt/contracts'

import * as dashboardApi from '@/api/dashboard'
import { listDashboardTemplates } from '@/api/dashboardTemplates'
import { listProjectThemes } from '@/api/projectThemes'
import { listRuntimeParams } from '@/api/runtimeParams'
import type { DashboardSummary, ProjectSummary } from '@/api/dashboardWire'
import { WORKBENCH_DIALOGS } from '@/pages/Home/dialogs'
import type { WorkbenchDialogName } from '@/pages/Home/dialogs'
import WorkbenchDialogs from '@/pages/Home/components/WorkbenchDialogs.vue'
import ImportDashboardDialog from '@/pages/Home/components/ImportDashboardDialog.vue'
import ImportFilePicker from '@/pages/Home/components/ImportFilePicker.vue'
import NewDashboardDialog from '@/pages/Home/components/NewDashboardDialog.vue'
import NewProjectDialog from '@/pages/Home/components/NewProjectDialog.vue'
import ProjectSettingsDialog from '@/pages/Home/components/ProjectSettingsDialog.vue'
import RuntimeParamsDialog from '@/pages/Home/components/RuntimeParamsDialog.vue'
import SaveAsTemplateDialog from '@/pages/Home/components/SaveAsTemplateDialog.vue'
import ShareDashboardDialog from '@/pages/Home/components/ShareDashboardDialog.vue'
import TemplateLibraryDialog from '@/pages/Home/components/TemplateLibraryDialog.vue'
import UnresolvedBindingsDialog from '@/pages/Home/components/UnresolvedBindingsDialog.vue'
import ValidateBindingsDialog from '@/pages/Home/components/ValidateBindingsDialog.vue'
import { useAuthStore } from '@/stores/auth'

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useRoute: () => ({ path: '/', query: {} }),
}))

vi.mock('@/api/projectThemes', () => ({
  listProjectThemes: vi.fn(),
  createProjectTheme: vi.fn(),
  updateProjectTheme: vi.fn(),
  deleteProjectTheme: vi.fn(),
}))

vi.mock('@/api/dashboardTemplates', () => ({
  listDashboardTemplates: vi.fn(),
  createDashboardTemplate: vi.fn(),
  deleteDashboardTemplate: vi.fn(),
  instantiateDashboardTemplate: vi.fn(),
}))

vi.mock('@/api/runtimeParams', () => ({
  listRuntimeParams: vi.fn(),
  saveRuntimeParams: vi.fn(),
  resetRuntimeParams: vi.fn(),
}))

const validateDashboard = vi.fn()

/**
 * ⚠ 出参必须每条用例重新给：`vi.restoreAllMocks()` 会把工厂里 `vi.fn()` 的实现
 * 一起清掉，只在工厂里写 `mockResolvedValue` 的话，第二条用例起这些接口就回
 * `undefined`，弹窗里 `rows.find(...)` 当场炸，而用例本身照样绿。
 */
function stubApis(): void {
  vi.mocked(listProjectThemes).mockResolvedValue([])
  vi.mocked(listRuntimeParams).mockResolvedValue([])
  vi.mocked(listDashboardTemplates).mockResolvedValue({
    items: [],
    page: 1,
    size: 20,
    total: 0,
  })
}

/**
 * `openName` → 该值下唯一应该打开的弹窗。
 * ⚠ `unresolved-bindings` 不在表里：它由导入/实例化的出参驱动，不看 `openName`。
 */
const MOUNTED_BY_NAME = [
  ['new-project', NewProjectDialog],
  ['new-dashboard', NewDashboardDialog],
  ['project-settings', ProjectSettingsDialog],
  ['save-as-template', SaveAsTemplateDialog],
  ['template-library', TemplateLibraryDialog],
  ['share', ShareDashboardDialog],
  ['validate', ValidateBindingsDialog],
  ['runtime-params', RuntimeParamsDialog],
  ['import', ImportFilePicker],
] as const

const ALL_MOUNTED = [
  ...MOUNTED_BY_NAME.map(([, component]) => component),
  ImportDashboardDialog,
  UnresolvedBindingsDialog,
]

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
  nodeCount: 3,
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

function render(openName: WorkbenchDialogName | null): VueWrapper {
  return mount(WorkbenchDialogs, {
    props: {
      openName,
      target: DASHBOARD,
      projects: [PROJECT],
      selectedProjectId: PROJECT.id,
      dashboards: [DASHBOARD],
    },
    global: { stubs: { Teleport: true } },
  })
}

enableAutoUnmount(afterEach)

beforeEach(() => {
  setActivePinia(createPinia())
  validateDashboard.mockReset().mockResolvedValue({
    dashboardId: 'd-1',
    isValid: true,
    issues: [],
  })
  vi.spyOn(dashboardApi, 'validateDashboard').mockImplementation(
    validateDashboard,
  )
  stubApis()
  signIn()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('十个弹窗都挂在树上', () => {
  it('一个都不许少——少一个的表现只是按钮点了没反应', () => {
    const wrapper = render(null)
    for (const component of ALL_MOUNTED) {
      expect(wrapper.findComponent(component).exists()).toBe(true)
    }
  })

  it('`dialogs.ts` 里登记的名字都有人认', () => {
    const covered = MOUNTED_BY_NAME.map(([name]) => name)
    const missing = WORKBENCH_DIALOGS.filter(
      (name) =>
        name !== 'unresolved-bindings' &&
        !covered.some((item) => item === name),
    )
    expect(missing).toEqual([])
  })
})

describe('openName 决定开哪一个', () => {
  for (const [name, opened] of MOUNTED_BY_NAME) {
    it(`${name} 只开它自己`, async () => {
      const wrapper = render(name)
      await flushPromises()

      expect(wrapper.getComponent(opened).props('open')).toBe(true)
      for (const [other, component] of MOUNTED_BY_NAME) {
        if (other === name) continue
        expect(
          wrapper.getComponent(component).props('open'),
          `${name} 打开时 ${other} 不该跟着开`,
        ).toBe(false)
      }
    })
  }

  it('都关着时一个都不开', async () => {
    const wrapper = render(null)
    await flushPromises()
    for (const [, component] of MOUNTED_BY_NAME) {
      expect(wrapper.getComponent(component).props('open')).toBe(false)
    }
  })
})

describe('导入分两步', () => {
  it('还没读到包时开的是选文件那一步，不是确认框', async () => {
    const wrapper = render('import')
    await flushPromises()

    expect(wrapper.getComponent(ImportFilePicker).props('open')).toBe(true)
    // ⚠ 确认框要摆出包里的名字与节点数，没有包时它只能渲染一个空壳
    expect(wrapper.getComponent(ImportDashboardDialog).props('open')).toBe(
      false,
    )
  })
})

describe('自检在弹窗打开的那一刻就发请求', () => {
  it('开 validate 时按目标屏发，而不是等用户再点一下', async () => {
    const wrapper = render('validate')
    await flushPromises()

    expect(validateDashboard).toHaveBeenCalledWith('d-1')
    expect(
      wrapper.getComponent(ValidateBindingsDialog).props('result'),
    ).toEqual({ dashboardId: 'd-1', isValid: true, issues: [] })
  })

  it('没开 validate 就不发', async () => {
    render('share')
    await flushPromises()
    expect(validateDashboard).not.toHaveBeenCalled()
  })
})
