/** @fileoverview 训练记录的直接发布、引用保护、筛选与权限。 */
import { PERMISSION_CODES } from '@dt/contracts'
import type {
  ModelDeployment,
  ModelingRunSummary,
  CursorPage,
} from '@dt/contracts'
import * as ui from '@dt/ui'
import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useRoute } from 'vue-router'
import * as modeling from '@/api/modeling'
import * as hierarchy from '@/api/hierarchy'
import * as workflow from '@/api/modelingWorkflow'
import { BizError } from '@/api/client'
import RunsPage from '@/pages/Modeling/Runs/index.vue'
import { useAuthStore } from '@/stores/auth'

vi.mock('vue-router', async () => {
  const { reactive } = await import('vue')
  const route = reactive<{
    path: string
    query: Record<string, string | string[] | null>
  }>({ path: '/modeling/runs', query: {} })
  return {
    useRoute: () => route,
    useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
    RouterLink: { template: '<a><slot /></a>' },
  }
})
const STAMP = '2026-01-01T00:00:00Z'
const run: ModelingRunSummary = {
  id: 'r1',
  pipeline_id: 'p1',
  pipeline_name: '能耗工作流',
  status: 'succeeded',
  trigger: 'manual',
  started_at: STAMP,
  finished_at: STAMP,
  duration_ms: 1200,
  row_count: 20,
  is_source_truncated: false,
  is_keeping_frames: false,
  error_text: null,
  created_by_name: '张三',
  created_at: STAMP,
  published_version_id: 'v1',
  publication_status: 'not_requested',
  publication_error: null,
  auto_publish: false,
}
const deployment: ModelDeployment = {
  id: 'd1',
  code: 'energy',
  model_version_id: 'v1',
  model_name: '能耗',
  model_version: 1,
  task: 'regression',
  name: '能耗',
  description: null,
  is_enabled: true,
  is_servable: true,
  unservable_reason: null,
  max_rows_per_call: 200,
  rate_limit_per_minute: 60,
  key_count: 0,
  created_by_name: null,
  created_at: STAMP,
  updated_at: STAMP,
}
const wrappers: VueWrapper[] = []
const ask = vi.fn().mockResolvedValue(true)
function open() {
  const wrapper = mount(RunsPage, { global: { stubs: { Teleport: true } } })
  wrappers.push(wrapper)
  return wrapper
}
function button(wrapper: VueWrapper, text: string) {
  const result = wrapper
    .findAll('button')
    .find(
      (item) => (item.attributes('aria-label') ?? item.text().trim()) === text,
    )
  if (!result) throw new Error(`缺少按钮：${text}`)
  return result
}
async function menuAction(wrapper: VueWrapper, text: string): Promise<void> {
  await button(wrapper, '训练记录更多操作').trigger('click')
  await flushPromises()
  const item = wrapper
    .findAll('[role="menuitem"]')
    .find((entry) => entry.text() === text)
  if (!item) throw new Error(`缺少菜单动作：${text}`)
  await item.trigger('click')
  await flushPromises()
}
beforeEach(() => {
  useRoute().query = {}
  localStorage.removeItem('dt.view-mode.modeling-runs')
  setActivePinia(createPinia())
  vi.spyOn(hierarchy, 'capabilities').mockRejectedValue(
    new Error('本用例不启用层级图服务'),
  )
  vi.spyOn(useAuthStore(), 'can').mockReturnValue(true)
  const confirm = ui.useConfirm()
  ask.mockReset().mockResolvedValue(true)
  vi.spyOn(ui, 'useConfirm').mockReturnValue({ ...confirm, ask })
  ui.useToast().clear()
  vi.spyOn(modeling, 'listModelingPipelines').mockResolvedValue({
    items: [
      {
        id: 'p1',
        code: 'energy',
        name: '能耗工作流',
        description: null,
        node_count: 4,
        source_table_codes: [],
        created_by_name: null,
        created_at: STAMP,
        updated_at: STAMP,
      },
    ],
    page: 1,
    size: 200,
    total: 1,
  })
  vi.spyOn(modeling, 'getModelingPipeline').mockImplementation((id) =>
    Promise.resolve({
      id,
      code: id,
      name: `工作流 ${id}`,
      description: null,
      node_count: 0,
      source_table_codes: [],
      created_by_name: null,
      created_at: STAMP,
      updated_at: STAMP,
      graph: { format_version: '1.0', nodes: [], edges: [] },
    }),
  )
  vi.spyOn(modeling, 'listModelingRunHistory').mockResolvedValue({
    items: [run],
    next: 'cursor:opaque+/=',
    has_more: true,
  })
  vi.spyOn(workflow, 'deployModelingRun').mockResolvedValue(deployment)
  vi.spyOn(workflow, 'deleteModelingRun').mockResolvedValue()
})
afterEach(() => {
  for (const wrapper of wrappers) wrapper.unmount()
  wrappers.length = 0
  vi.restoreAllMocks()
})

it('成功训练直接发布固定入口，无需再次填写模型名称与服务编码', async () => {
  const wrapper = open()
  await flushPromises()
  expect(wrapper.text()).toContain('模型已保存')
  await menuAction(wrapper, '发布模型')
  await flushPromises()
  expect(workflow.deployModelingRun).toHaveBeenCalledWith('r1')
  expect(ui.useToast().toasts.value.at(-1)?.message).toContain(
    '调用编码：energy',
  )
  expect(modeling.listModelingRunHistory).toHaveBeenCalledTimes(2)
})
it('取消发布确认时不发请求', async () => {
  ask.mockResolvedValue(false)
  const wrapper = open()
  await flushPromises()
  await menuAction(wrapper, '发布模型')
  await flushPromises()
  expect(workflow.deployModelingRun).not.toHaveBeenCalled()
})
it('输入输出签名变化须明确确认后发布', async () => {
  vi.mocked(workflow.deployModelingRun).mockRejectedValueOnce(
    new BizError(41435, '签名变化', 409, 'trace'),
  )
  const wrapper = open()
  await flushPromises()
  await menuAction(wrapper, '发布模型')
  await flushPromises()
  expect(ask).toHaveBeenLastCalledWith(
    expect.objectContaining({ title: '新模型的调用格式有变化', danger: true }),
  )
  expect(workflow.deployModelingRun).toHaveBeenLastCalledWith('r1', true)
})
it('删除记录时展示清理范围，引用冲突作为错误反馈', async () => {
  vi.mocked(workflow.deleteModelingRun).mockRejectedValue(
    new BizError(41438, '当前模型仍在部署', 409, 'trace'),
  )
  const wrapper = open()
  await flushPromises()
  await menuAction(wrapper, '删除记录')
  await flushPromises()
  expect(ask).toHaveBeenCalledWith(
    expect.objectContaining({
      danger: true,
      message: expect.stringContaining('配置快照'),
    }),
  )
  expect(workflow.deleteModelingRun).toHaveBeenCalledWith('r1')
  expect(ui.useToast().toasts.value.at(-1)?.message).toContain(
    '当前模型仍在部署',
  )
})
it('删除未引用训练后刷新列表', async () => {
  const wrapper = open()
  await flushPromises()
  await menuAction(wrapper, '删除记录')
  await flushPromises()
  expect(modeling.listModelingRunHistory).toHaveBeenCalledTimes(2)
})
it.each(['pending', 'running', 'cancelling'] as const)(
  '在途%s不能发布或删除',
  async (status) => {
    vi.mocked(modeling.listModelingRunHistory).mockResolvedValue({
      items: [{ ...run, status }],
      next: 'cursor:opaque+/=',
      has_more: true,
    })
    const wrapper = open()
    await flushPromises()
    expect(
      wrapper
        .findAll('button')
        .some((item) => ['发布模型', '删除记录'].includes(item.text().trim())),
    ).toBe(false)
  },
)
it('只读账号没有发布和删除菜单，结果查看仍保留', async () => {
  vi.mocked(useAuthStore().can).mockImplementation((codes) =>
    codes.includes(PERMISSION_CODES.modelingView),
  )
  const wrapper = open()
  await flushPromises()
  expect(
    wrapper
      .findAll('button')
      .some((item) => ['发布模型', '删除记录'].includes(item.text().trim())),
  ).toBe(false)
  expect(wrapper.find('button[aria-label="训练记录更多操作"]').exists()).toBe(
    false,
  )
  expect(wrapper.find('button[aria-label="查看训练结果"]').exists()).toBe(true)
})
it('筛选工作流重置到第一页并传递取消信号', async () => {
  const wrapper = open()
  await flushPromises()
  await button(wrapper, '筛选工作流').trigger('click')
  await flushPromises()
  await button(wrapper, '选择工作流 能耗工作流').trigger('click')
  await flushPromises()
  expect(modeling.listModelingRunHistory).toHaveBeenLastCalledWith(
    'p1',
    { limit: 20 },
    expect.any(AbortSignal),
  )
})
it('发布失败提示原因且保留原列表', async () => {
  vi.mocked(workflow.deployModelingRun).mockRejectedValue(new Error('offline'))
  const wrapper = open()
  await flushPromises()
  await menuAction(wrapper, '发布模型')
  await flushPromises()
  expect(ui.useToast().toasts.value.at(-1)?.message).toContain('请求失败')
  expect(wrapper.text()).toContain('能耗工作流')
})
it('离开页面后迟到发布结果不触发提示或刷新', async () => {
  let finish: ((result: ModelDeployment) => void) | undefined
  vi.mocked(workflow.deployModelingRun).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  const wrapper = open()
  await flushPromises()
  await menuAction(wrapper, '发布模型')
  await flushPromises()
  wrapper.unmount()
  wrappers.splice(wrappers.indexOf(wrapper), 1)
  finish?.(deployment)
  await flushPromises()
  expect(ui.useToast().toasts.value).toHaveLength(0)
  expect(modeling.listModelingRunHistory).toHaveBeenCalledTimes(1)
})

it('刷新图标保留名称、点击刷新和加载禁用语义', async () => {
  const wrapper = open()
  await flushPromises()
  let finish: ((result: CursorPage<ModelingRunSummary>) => void) | undefined
  const pending = new Promise<CursorPage<ModelingRunSummary>>((resolve) => {
    finish = resolve
  })
  vi.mocked(modeling.listModelingRunHistory).mockReturnValueOnce(pending)
  const refresh = wrapper.get('button[aria-label="刷新训练状态"]')
  expect(refresh.classes()).toContain('dt-btn--icon-only')
  await refresh.trigger('click')
  expect(modeling.listModelingRunHistory).toHaveBeenCalledTimes(2)
  expect(refresh.attributes('aria-busy')).toBe('true')
  expect(refresh.attributes('disabled')).toBeDefined()
  finish?.({ items: [run], next: null, has_more: false })
  await flushPromises()
  expect(refresh.attributes('aria-busy')).toBeUndefined()
  expect(refresh.attributes('disabled')).toBeUndefined()
})

it('列表的查看结果入口将所选训练ID传到历史结果面', async () => {
  const second = { ...run, id: 'r2', created_at: '2026-11-03T01:00:00Z' }
  vi.mocked(modeling.listModelingRunHistory).mockResolvedValue({
    items: [run, second],
    next: 'cursor:opaque+/=',
    has_more: true,
  })
  const history = vi
    .spyOn(modeling, 'getModelingRun')
    .mockImplementation((id) =>
      Promise.resolve({
        ...run,
        id,
        graph: { format_version: '1.0', nodes: [], edges: [] },
        nodes: [],
      }),
    )
  vi.spyOn(modeling, 'listModelingOperators').mockResolvedValue([])
  const wrapper = open()
  await flushPromises()
  const buttons = wrapper.findAll('button[aria-label="查看训练结果"]')
  expect(buttons).toHaveLength(2)
  await buttons[1]?.trigger('click')
  await vi.dynamicImportSettled()
  await flushPromises()
  expect(history).toHaveBeenCalledWith('r2', expect.any(AbortSignal))
  const detail = wrapper.findComponent({ name: 'RunResultsDialog' })
  expect(detail.props('run')).toMatchObject({ id: 'r2' })
  await detail.get('button[aria-label="关闭"]').trigger('click')
  expect(wrapper.findComponent({ name: 'RunResultsDialog' }).exists()).toBe(
    false,
  )
  await buttons[0]?.trigger('click')
  await vi.dynamicImportSettled()
  await flushPromises()
  expect(
    wrapper.findComponent({ name: 'RunResultsDialog' }).props('run'),
  ).toMatchObject({ id: 'r1' })
})

function stubHistory() {
  vi.spyOn(modeling, 'getModelingRun').mockImplementation((id) =>
    Promise.resolve({
      ...run,
      id,
      graph: { format_version: '1.0', nodes: [], edges: [] },
      nodes: [],
    }),
  )
  vi.spyOn(modeling, 'listModelingOperators').mockResolvedValue([])
}

it('路由切换工作流关闭历史结果并回到第一页，清除查询恢复全部工作流', async () => {
  useRoute().query = { pipeline_id: 'p1' }
  vi.mocked(modeling.listModelingRunHistory).mockResolvedValue({
    items: [run],
    next: 'cursor:opaque+/=',
    has_more: true,
  })
  stubHistory()
  const wrapper = open()
  await flushPromises()
  expect(modeling.listModelingRunHistory).toHaveBeenLastCalledWith(
    'p1',
    { limit: 20 },
    expect.any(AbortSignal),
  )
  await button(wrapper, '下一页').trigger('click')
  await flushPromises()
  expect(modeling.listModelingRunHistory).toHaveBeenLastCalledWith(
    'p1',
    { limit: 20, after: 'cursor:opaque+/=' },
    expect.any(AbortSignal),
  )
  await button(wrapper, '查看训练结果').trigger('click')
  await vi.dynamicImportSettled()
  await flushPromises()
  expect(wrapper.findComponent({ name: 'RunResultsDialog' }).exists()).toBe(
    true,
  )
  useRoute().query = { pipeline_id: 'p2' }
  await flushPromises()
  expect(wrapper.findComponent({ name: 'RunResultsDialog' }).exists()).toBe(
    false,
  )
  expect(modeling.listModelingRunHistory).toHaveBeenLastCalledWith(
    'p2',
    { limit: 20 },
    expect.any(AbortSignal),
  )
  useRoute().query = {}
  await flushPromises()
  expect(modeling.listModelingRunHistory).toHaveBeenLastCalledWith(
    null,
    { limit: 20 },
    expect.any(AbortSignal),
  )
})

it('翻页和切换每页数量发出对应查询，数量改变回第一页', async () => {
  vi.mocked(modeling.listModelingRunHistory).mockResolvedValue({
    items: [run],
    next: 'cursor:opaque+/=',
    has_more: true,
  })
  const wrapper = open()
  await flushPromises()
  await button(wrapper, '下一页').trigger('click')
  await flushPromises()
  expect(modeling.listModelingRunHistory).toHaveBeenLastCalledWith(
    null,
    { limit: 20, after: 'cursor:opaque+/=' },
    expect.any(AbortSignal),
  )
  await wrapper.get('button[aria-label="每页条数"]').trigger('click')
  const size = wrapper
    .findAll('[role="option"]')
    .find((option) => option.text() === '50 条/页')
  if (!size) throw new Error('缺少每页50条')
  await size.trigger('click')
  await flushPromises()
  expect(modeling.listModelingRunHistory).toHaveBeenLastCalledWith(
    null,
    { limit: 50 },
    expect.any(AbortSignal),
  )
  await wrapper.get('button[aria-label="卡片视图"]').trigger('click')
  expect(wrapper.find('.dt-data-view__grid').exists()).toBe(true)
})

it('记录读取失败可从重试按钮恢复列表', async () => {
  vi.mocked(modeling.listModelingRunHistory).mockRejectedValueOnce(
    new Error('offline'),
  )
  const wrapper = open()
  await flushPromises()
  expect(wrapper.text()).toContain('请求失败，请重试')
  await button(wrapper, '重试').trigger('click')
  await flushPromises()
  expect(modeling.listModelingRunHistory).toHaveBeenCalledTimes(2)
  expect(wrapper.text()).toContain('能耗工作流')
  expect(wrapper.text()).not.toContain('请求失败，请重试')
})
