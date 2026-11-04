/** @fileoverview 训练记录本页选择、权限、串行批量清理与取消。 */
import { PERMISSION_CODES } from '@dt/contracts'
import type { ModelingRun, ModelingRunSummary } from '@dt/contracts'
import * as ui from '@dt/ui'
import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { BizError, TransportError } from '@/api/client'
import * as hierarchy from '@/api/hierarchy'
import * as modeling from '@/api/modeling'
import * as workflow from '@/api/modelingWorkflow'
import RunsPage from '@/pages/Modeling/Runs/index.vue'
import RunTable from '@/pages/Modeling/Runs/components/RunTable.vue'
import { useAuthStore } from '@/stores/auth'
import { deployment } from '@/testing/modelingTemplateFixtures'

vi.mock('vue-router', () => ({
  useRoute: () => ({ path: '/modeling/runs', query: {} }),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  RouterLink: { template: '<a><slot /></a>' },
}))
const wrappers: VueWrapper[] = []
const ask = vi.fn().mockResolvedValue(true)
function row(
  id: string,
  changes: Partial<ModelingRunSummary> = {},
): ModelingRunSummary {
  return {
    id,
    pipeline_id: 'p1',
    status: 'succeeded',
    trigger: 'manual',
    started_at: null,
    finished_at: null,
    duration_ms: 1,
    row_count: 1,
    is_source_truncated: false,
    is_keeping_frames: false,
    error_text: null,
    created_by_name: null,
    created_at: '2026-11-04T00:00:00Z',
    publication_status: 'not_requested',
    ...changes,
  }
}
function open() {
  const wrapper = mount(RunsPage, { global: { stubs: { Teleport: true } } })
  wrappers.push(wrapper)
  return wrapper
}
function button(wrapper: VueWrapper, text: string) {
  const target = wrapper.findAll('button').find((item) => item.text() === text)
  if (!target) throw new Error(`缺少按钮：${text}`)
  return target
}
function list(rows: ModelingRunSummary[]) {
  vi.mocked(modeling.listModelingRunHistory).mockResolvedValue({
    items: rows,
    next: 'cursor:opaque+/=',
    has_more: true,
  })
}
beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
  vi.spyOn(useAuthStore(), 'can').mockReturnValue(true)
  vi.spyOn(hierarchy, 'capabilities').mockRejectedValue(new Error('未启用'))
  const confirm = ui.useConfirm()
  ask.mockReset().mockResolvedValue(true)
  vi.spyOn(ui, 'useConfirm').mockReturnValue({ ...confirm, ask })
  vi.spyOn(modeling, 'listModelingPipelines').mockResolvedValue({
    items: [],
    page: 1,
    size: 200,
    total: 0,
  })
  vi.spyOn(modeling, 'listModelingRunHistory').mockResolvedValue({
    items: [row('r1'), row('r2')],
    next: 'cursor:opaque+/=',
    has_more: true,
  })
  vi.spyOn(workflow, 'deleteModelingRun').mockResolvedValue()
  vi.spyOn(workflow, 'deployModelingRun').mockResolvedValue(deployment)
  vi.spyOn(modeling, 'cancelModelingRun').mockImplementation(
    (id): Promise<ModelingRun> =>
      Promise.resolve({
        ...row(id, { status: 'cancelling' }),
        graph: { format_version: '1.0', nodes: [], edges: [] },
        nodes: [],
      }),
  )
})
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount())
  ui.useToast().clear()
  vi.restoreAllMocks()
})
it('只读或仅管理权限不显示选择与批量写操作', async () => {
  vi.mocked(useAuthStore().can).mockImplementation((codes) =>
    codes.includes(PERMISSION_CODES.modelingManage),
  )
  const wrapper = open()
  await flushPromises()
  expect(wrapper.find('input[type="checkbox"]').exists()).toBe(false)
  expect(wrapper.find('[aria-label="批量操作"]').exists()).toBe(false)
})
it('删除逐项反馈引用冲突，跳过在途与正在发布记录并只刷新一次', async () => {
  list([
    row('r1'),
    row('r2'),
    row('r3', { status: 'running' }),
    row('r4', { publication_status: 'pending' }),
  ])
  vi.mocked(workflow.deleteModelingRun).mockRejectedValueOnce(
    new BizError(41438, '模型仍被部署引用', 409, 'trace'),
  )
  const wrapper = open()
  await flushPromises()
  await wrapper.get('input[aria-label="选择本页"]').setValue(true)
  await button(wrapper, '批量删除记录').trigger('click')
  await flushPromises()
  expect(ask).toHaveBeenCalledOnce()
  expect(workflow.deleteModelingRun).toHaveBeenCalledTimes(2)
  expect(workflow.deleteModelingRun).toHaveBeenNthCalledWith(1, 'r1')
  expect(workflow.deleteModelingRun).toHaveBeenNthCalledWith(2, 'r2')
  expect(modeling.listModelingRunHistory).toHaveBeenCalledTimes(2)
  expect(wrapper.text()).toContain('模型仍被部署引用')
  expect(wrapper.text()).toContain('训练仍在进行')
  expect(wrapper.text()).toContain('正在发布模型')
  expect(
    wrapper.get<HTMLInputElement>('input[aria-label="选择 训练 r1"]').element
      .checked,
  ).toBe(true)
  expect(
    wrapper.get<HTMLInputElement>('input[aria-label="选择 训练 r2"]').element
      .checked,
  ).toBe(false)
})
it('训练权限可批量取消排队与运行项，终态及取消中项跳过', async () => {
  vi.mocked(useAuthStore().can).mockImplementation((codes) =>
    codes.includes(PERMISSION_CODES.modelingRun),
  )
  list([
    row('r1', { status: 'pending' }),
    row('r2', { status: 'running' }),
    row('r3', { status: 'cancelling' }),
    row('r4'),
  ])
  const wrapper = open()
  await flushPromises()
  await wrapper.get('input[aria-label="选择本页"]').setValue(true)
  expect(
    wrapper.findAll('button').some((item) => item.text() === '批量删除记录'),
  ).toBe(false)
  await button(wrapper, '批量取消训练').trigger('click')
  await flushPromises()
  expect(modeling.cancelModelingRun).toHaveBeenCalledTimes(2)
  expect(wrapper.text()).toContain('训练已结束或正在取消')
})
it('切换表卡保留选择，翻页后清除选择', async () => {
  const wrapper = open()
  await flushPromises()
  await wrapper.get('input[aria-label="选择本页"]').setValue(true)
  wrapper.getComponent(RunTable).vm.$emit('update:view', 'card')
  await flushPromises()
  expect(wrapper.find('.dt-data-view__selectable-card').exists()).toBe(true)
  expect(
    wrapper.get<HTMLInputElement>('input[aria-label="选择 训练 r1"]').element
      .checked,
  ).toBe(true)
  await button(wrapper, '下一页').trigger('click')
  await flushPromises()
  expect(wrapper.find('[aria-label="批量操作"]').exists()).toBe(false)
})
it('批量处理中禁用选择与单项发布，卸载后不继续下一项', async () => {
  let finish: (() => void) | undefined
  vi.mocked(workflow.deleteModelingRun).mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve
      }),
  )
  const wrapper = open()
  await flushPromises()
  await wrapper.get('input[aria-label="选择本页"]').setValue(true)
  await button(wrapper, '批量删除记录').trigger('click')
  await flushPromises()
  expect(
    wrapper
      .findAll('input[type="checkbox"]')
      .every((input) => input.attributes('disabled') !== undefined),
  ).toBe(true)
  expect(wrapper.getComponent(RunTable).props('canPublish')).toBe(false)
  wrapper.unmount()
  wrappers.splice(wrappers.indexOf(wrapper), 1)
  finish?.()
  await flushPromises()
  expect(workflow.deleteModelingRun).toHaveBeenCalledTimes(1)
  expect(modeling.listModelingRunHistory).toHaveBeenCalledTimes(1)
})

it('批量结果待核查时锁住行菜单及写事件，查看入口保持可用', async () => {
  vi.mocked(workflow.deleteModelingRun).mockRejectedValueOnce(
    new TransportError(0, '请求结果未知'),
  )
  const wrapper = open()
  await flushPromises()
  await wrapper.get('input[aria-label="选择本页"]').setValue(true)
  await button(wrapper, '批量删除记录').trigger('click')
  await flushPromises()
  expect(workflow.deleteModelingRun).toHaveBeenCalledTimes(1)
  expect(wrapper.text()).toContain('结果待核查')
  const more = wrapper.findAll('button[aria-label="训练记录更多操作"]')[0]
  if (!more) throw new Error('缺少行菜单')
  await more.trigger('click')
  await flushPromises()
  const menu = wrapper.findAll('[role="menuitem"]')
  expect(menu).toHaveLength(2)
  for (const item of menu) {
    expect(item.attributes('disabled')).toBeDefined()
    await item.trigger('click')
  }
  wrapper.getComponent(RunTable).vm.$emit('remove', row('r1'))
  wrapper.getComponent(RunTable).vm.$emit('publish', row('r1'))
  await flushPromises()
  expect(workflow.deleteModelingRun).toHaveBeenCalledTimes(1)
  expect(workflow.deployModelingRun).not.toHaveBeenCalled()
  expect(ask).toHaveBeenCalledOnce()
  expect(
    wrapper
      .findAll('button[aria-label="查看训练结果"]')
      .every((item) => item.attributes('disabled') === undefined),
  ).toBe(true)
  await button(wrapper, '清除选择与结果').trigger('click')
  expect(wrapper.getComponent(RunTable).props('canPublish')).toBe(true)
})

it('取消批量确认后单项操作保持可用', async () => {
  ask.mockResolvedValueOnce(false)
  const wrapper = open()
  await flushPromises()
  await wrapper.get('input[aria-label="选择本页"]').setValue(true)
  await button(wrapper, '批量删除记录').trigger('click')
  await flushPromises()
  expect(workflow.deleteModelingRun).not.toHaveBeenCalled()
  expect(wrapper.getComponent(RunTable).props('canPublish')).toBe(true)
  wrapper.getComponent(RunTable).vm.$emit('remove', row('r1'))
  await flushPromises()
  expect(workflow.deleteModelingRun).toHaveBeenCalledExactlyOnceWith('r1')
})

it('待核查结果在检索和游标翻页后仍阻止写入，显式清除才能解锁', async () => {
  vi.mocked(workflow.deleteModelingRun).mockRejectedValueOnce(
    new TransportError(0, '请求结果未知'),
  )
  const wrapper = open()
  await flushPromises()
  await wrapper.get('input[aria-label="选择本页"]').setValue(true)
  await button(wrapper, '批量删除记录').trigger('click')
  await flushPromises()
  await wrapper.get('input[type="search"]').setValue('new-scope')
  await wrapper.get('form').trigger('submit')
  await flushPromises()
  await button(wrapper, '下一页').trigger('click')
  await flushPromises()
  expect(wrapper.text()).toContain('结果待核查')
  expect(wrapper.getComponent(RunTable).props('canPublish')).toBe(false)
  expect(
    wrapper.getComponent(RunTable).props('selection')?.selectedIds,
  ).toEqual([])
  wrapper.getComponent(RunTable).vm.$emit('remove', row('r2'))
  await flushPromises()
  expect(workflow.deleteModelingRun).toHaveBeenCalledOnce()
  await button(wrapper, '清除选择与结果').trigger('click')
  expect(wrapper.getComponent(RunTable).props('canPublish')).toBe(true)
})
