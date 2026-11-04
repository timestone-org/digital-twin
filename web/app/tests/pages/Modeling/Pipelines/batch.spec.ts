/** @fileoverview 工作流批量提交、显式定时策略与筛选选择和单项写互斥。 */
import { PERMISSION_CODES } from '@dt/contracts'
import type { ModelingPipelineSummary, ModelingSchedule } from '@dt/contracts'
import * as ui from '@dt/ui'
import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { ref } from 'vue'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { BizError, TransportError } from '@/api/client'
import * as hierarchy from '@/api/hierarchy'
import * as modeling from '@/api/modeling'
import * as workflow from '@/api/modelingWorkflow'
import PipelinesPage from '@/pages/Modeling/Pipelines/index.vue'
import PipelineActions from '@/pages/Modeling/Pipelines/components/PipelineActions.vue'
import PipelineBatchScheduleDialog from '@/pages/Modeling/Pipelines/components/PipelineBatchScheduleDialog.vue'
import PipelineFormDialog from '@/pages/Modeling/Pipelines/components/PipelineFormDialog.vue'
import { useAuthStore } from '@/stores/auth'

vi.mock('vue-router', () => ({
  useRoute: () => ({ path: '/modeling/pipelines', query: {} }),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  RouterLink: { template: '<a><slot /></a>' },
}))
const STAMP = '2026-11-04T00:00:00Z'
const permissions = ref<string[]>([])
const wrappers: VueWrapper[] = []
const ask = vi.fn().mockResolvedValue(true)
function pipeline(id: string, code = id): ModelingPipelineSummary {
  return {
    id,
    code,
    name: id,
    description: null,
    node_count: 1,
    source_table_codes: [],
    created_by_name: null,
    created_at: STAMP,
    updated_at: STAMP,
  }
}
function schedule(
  id: string,
  changes: Partial<ModelingSchedule> = {},
): ModelingSchedule {
  return {
    pipeline_id: id,
    is_enabled: false,
    interval_minutes: 30,
    auto_publish: true,
    next_run_at: null,
    last_run_at: null,
    last_run_id: null,
    last_error: null,
    revision: 4,
    updated_at: STAMP,
    ...changes,
  }
}
function open() {
  const wrapper = mount(PipelinesPage, {
    global: { stubs: { Teleport: true } },
  })
  wrappers.push(wrapper)
  return wrapper
}
function button(wrapper: VueWrapper, text: string) {
  const target = wrapper.findAll('button').find((item) => item.text() === text)
  if (!target) throw new Error(`缺少按钮：${text}`)
  return target
}
async function chooseAll(wrapper: VueWrapper): Promise<void> {
  await wrapper.get('input[aria-label="选择本页"]').setValue(true)
}
async function openSchedule(wrapper: VueWrapper): Promise<void> {
  await chooseAll(wrapper)
  await button(wrapper, '批量开启定时训练').trigger('click')
  await flushPromises()
}
beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
  permissions.value = [
    PERMISSION_CODES.modelingView,
    PERMISSION_CODES.modelingRun,
    PERMISSION_CODES.modelingPublish,
    PERMISSION_CODES.modelingManage,
  ]
  vi.spyOn(useAuthStore(), 'can').mockImplementation((codes) =>
    codes.every((code) => permissions.value.includes(code)),
  )
  vi.spyOn(hierarchy, 'capabilities').mockRejectedValue(new Error('未启用'))
  const confirm = ui.useConfirm()
  ask.mockReset().mockResolvedValue(true)
  vi.spyOn(ui, 'useConfirm').mockReturnValue({ ...confirm, ask })
  vi.spyOn(modeling, 'listModelingPipelines').mockResolvedValue({
    items: [pipeline('p1', 'energy'), pipeline('p2', 'anomaly')],
    page: 1,
    size: 200,
    total: 205,
  })
  vi.spyOn(modeling, 'deleteModelingPipeline').mockResolvedValue()
  vi.spyOn(modeling, 'startModelingRun').mockImplementation((id) =>
    Promise.resolve({
      id: `r-${id}`,
      pipeline_id: id,
      status: 'pending',
      trigger: 'manual',
      started_at: null,
      finished_at: null,
      duration_ms: null,
      row_count: null,
      is_source_truncated: false,
      is_keeping_frames: false,
      error_text: null,
      created_by_name: null,
      created_at: STAMP,
      graph: { format_version: '1.0', nodes: [], edges: [] },
      nodes: [],
    }),
  )
  vi.spyOn(workflow, 'getModelingSchedule').mockImplementation((id) =>
    Promise.resolve(
      id === 'p1'
        ? schedule(id)
        : schedule(id, {
            revision: 0,
            auto_publish: false,
            interval_minutes: 1440,
          }),
    ),
  )
  vi.spyOn(workflow, 'saveModelingSchedule').mockImplementation((id, payload) =>
    Promise.resolve(
      schedule(id, { ...payload, revision: payload.expected_revision + 1 }),
    ),
  )
})
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount())
  ui.useToast().clear()
  vi.restoreAllMocks()
})
it('单项删除等待回执时锁住本页选择与批量写入', async () => {
  let finish: (() => void) | undefined
  vi.mocked(modeling.deleteModelingPipeline).mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve
      }),
  )
  const wrapper = open()
  await flushPromises()
  await chooseAll(wrapper)
  await wrapper
    .findAll('button[aria-label="工作流更多操作"]')[0]
    ?.trigger('click')
  await flushPromises()
  const remove = wrapper
    .findAll('[role="menuitem"]')
    .find((item) => item.text() === '删除工作流')
  await remove?.trigger('click')
  await flushPromises()
  try {
    expect(button(wrapper, '批量训练').attributes('disabled')).toBeDefined()
    expect(
      wrapper.get('input[aria-label="选择本页"]').attributes('disabled'),
    ).toBeDefined()
  } finally {
    finish?.()
    await flushPromises()
  }
})
it('只读账号没有选择；训练权限不授予工作流删除', async () => {
  permissions.value = [PERMISSION_CODES.modelingView]
  const wrapper = open()
  await flushPromises()
  expect(wrapper.find('input[type="checkbox"]').exists()).toBe(false)
  permissions.value = [
    PERMISSION_CODES.modelingView,
    PERMISSION_CODES.modelingRun,
  ]
  await flushPromises()
  await chooseAll(wrapper)
  expect(
    wrapper.findAll('button').some((item) => item.text() === '批量训练'),
  ).toBe(true)
  expect(
    wrapper.findAll('button').some((item) => item.text() === '批量删除工作流'),
  ).toBe(false)
})
it('选择限当前后端页，提交关键词清选而草稿与表卡切换保留', async () => {
  const wrapper = open()
  await flushPromises()
  expect(wrapper.text()).toContain('205')
  await chooseAll(wrapper)
  await wrapper.get('button[aria-label="卡片视图"]').trigger('click')
  await flushPromises()
  expect(
    wrapper.get<HTMLInputElement>('input[aria-label="选择 工作流 p1"]').element
      .checked,
  ).toBe(true)
  await wrapper.get('input[aria-label="搜索工作流"]').setValue('energy')
  expect(wrapper.text()).toContain('已选择 2 项')
  vi.mocked(modeling.listModelingPipelines).mockResolvedValue({
    items: [pipeline('p1', 'energy')],
    page: 1,
    size: 20,
    total: 205,
  })
  await wrapper.get('form').trigger('submit')
  await flushPromises()
  expect(wrapper.find('[aria-label="批量操作"]').exists()).toBe(false)
  await chooseAll(wrapper)
  await button(wrapper, '下一页').trigger('click')
  await flushPromises()
  expect(wrapper.find('[aria-label="批量操作"]').exists()).toBe(false)
  await chooseAll(wrapper)
  wrapper.getComponent(ui.DtPagination).vm.$emit('update:size', 50)
  await flushPromises()
  expect(wrapper.find('[aria-label="批量操作"]').exists()).toBe(false)
  await chooseAll(wrapper)
  await button(wrapper, '批量训练').trigger('click')
  await flushPromises()
  expect(modeling.startModelingRun).toHaveBeenCalledOnce()
  expect(modeling.startModelingRun).toHaveBeenCalledWith('p1')
})
it('批量提交训练只确认一次，成功表示提交且不启用自动发布', async () => {
  const wrapper = open()
  await flushPromises()
  await chooseAll(wrapper)
  await button(wrapper, '批量训练').trigger('click')
  await flushPromises()
  expect(ask).toHaveBeenCalledOnce()
  expect(ask).toHaveBeenCalledWith(
    expect.objectContaining({
      message: expect.stringContaining('成功仅表示请求已提交'),
    }),
  )
  expect(modeling.startModelingRun).toHaveBeenCalledTimes(2)
  expect(modeling.startModelingRun).toHaveBeenNthCalledWith(1, 'p1')
  expect(modeling.startModelingRun).toHaveBeenNthCalledWith(2, 'p2')
  expect(modeling.listModelingPipelines).toHaveBeenCalledTimes(2)
})
it('批量删除只确认一次，取消确认不提交', async () => {
  ask.mockResolvedValueOnce(false)
  const wrapper = open()
  await flushPromises()
  await chooseAll(wrapper)
  await button(wrapper, '批量删除工作流').trigger('click')
  await flushPromises()
  expect(modeling.deleteModelingPipeline).not.toHaveBeenCalled()
  await button(wrapper, '批量删除工作流').trigger('click')
  await flushPromises()
  expect(modeling.deleteModelingPipeline).toHaveBeenCalledTimes(2)
  expect(ask).toHaveBeenCalledTimes(2)
  expect(ask).toHaveBeenLastCalledWith(
    expect.objectContaining({ danger: true }),
  )
})
it('显式开启弹窗是唯一确认，默认保留已有规则并填补未配置项', async () => {
  const wrapper = open()
  await flushPromises()
  await openSchedule(wrapper)
  expect(workflow.saveModelingSchedule).not.toHaveBeenCalled()
  await button(wrapper, '保存并开启').trigger('click')
  await flushPromises()
  expect(ask).not.toHaveBeenCalled()
  expect(workflow.saveModelingSchedule).toHaveBeenNthCalledWith(1, 'p1', {
    is_enabled: true,
    interval_minutes: 30,
    auto_publish: true,
    expected_revision: 4,
  })
  expect(workflow.saveModelingSchedule).toHaveBeenNthCalledWith(2, 'p2', {
    is_enabled: true,
    interval_minutes: 1440,
    auto_publish: false,
    expected_revision: 0,
  })
  expect(wrapper.findComponent(PipelineBatchScheduleDialog).exists()).toBe(
    false,
  )
})
it('明确统一策略后才按新周期保存每项，仍携带各自修订号', async () => {
  const wrapper = open()
  await flushPromises()
  await openSchedule(wrapper)
  const dialog = wrapper.getComponent(PipelineBatchScheduleDialog)
  dialog.getComponent(ui.DtSelect).vm.$emit('update:modelValue', 'replace')
  dialog.getComponent(ui.DtNumberInput).vm.$emit('update:modelValue', 60)
  await flushPromises()
  await button(wrapper, '保存并开启').trigger('click')
  await flushPromises()
  expect(workflow.saveModelingSchedule).toHaveBeenNthCalledWith(1, 'p1', {
    is_enabled: true,
    interval_minutes: 60,
    auto_publish: false,
    expected_revision: 4,
  })
  expect(workflow.saveModelingSchedule).toHaveBeenNthCalledWith(2, 'p2', {
    is_enabled: true,
    interval_minutes: 60,
    auto_publish: false,
    expected_revision: 0,
  })
})
it('无发布权时拒绝恢复已有自动发布项，不强清且继续非自动发布项', async () => {
  permissions.value = [
    PERMISSION_CODES.modelingView,
    PERMISSION_CODES.modelingRun,
  ]
  const wrapper = open()
  await flushPromises()
  await openSchedule(wrapper)
  await button(wrapper, '保存并开启').trigger('click')
  await flushPromises()
  expect(workflow.saveModelingSchedule).toHaveBeenCalledOnce()
  expect(workflow.saveModelingSchedule).toHaveBeenCalledWith('p2', {
    is_enabled: true,
    interval_minutes: 1440,
    auto_publish: false,
    expected_revision: 0,
  })
  expect(wrapper.text()).toContain('需要模型发布权限')
})
it('关闭定时保留原周期及自动发布，服务端拒绝后不自动更改配置重试', async () => {
  permissions.value = [
    PERMISSION_CODES.modelingView,
    PERMISSION_CODES.modelingRun,
  ]
  vi.mocked(workflow.getModelingSchedule).mockImplementation((id) =>
    Promise.resolve(
      schedule(id, {
        is_enabled: true,
        auto_publish: id === 'p1',
        interval_minutes: id === 'p1' ? 30 : 60,
      }),
    ),
  )
  vi.mocked(workflow.saveModelingSchedule).mockRejectedValueOnce(
    new BizError(40301, '自动发布需要发布权限', 403, 'trace'),
  )
  const wrapper = open()
  await flushPromises()
  await chooseAll(wrapper)
  await button(wrapper, '批量关闭定时训练').trigger('click')
  await flushPromises()
  expect(workflow.saveModelingSchedule).toHaveBeenCalledTimes(2)
  expect(workflow.saveModelingSchedule).toHaveBeenNthCalledWith(1, 'p1', {
    is_enabled: false,
    interval_minutes: 30,
    auto_publish: true,
    expected_revision: 4,
  })
  expect(workflow.saveModelingSchedule).toHaveBeenNthCalledWith(2, 'p2', {
    is_enabled: false,
    interval_minutes: 60,
    auto_publish: false,
    expected_revision: 4,
  })
  expect(wrapper.text()).toContain('自动发布需要发布权限')
})
it('GET未返回时卸载会取消读取且不提交定时写入', async () => {
  let complete: ((value: ModelingSchedule) => void) | undefined
  let signal: AbortSignal | undefined
  vi.mocked(workflow.getModelingSchedule).mockImplementationOnce(
    (_id, given) => {
      signal = given
      return new Promise<ModelingSchedule>((resolve) => {
        complete = resolve
      })
    },
  )
  const wrapper = open()
  await flushPromises()
  await openSchedule(wrapper)
  await button(wrapper, '保存并开启').trigger('click')
  await flushPromises()
  expect(
    wrapper.get('input[aria-label="选择本页"]').attributes('disabled'),
  ).toBeDefined()
  expect(wrapper.getComponent(PipelineActions).props('isSaving')).toBe(true)
  wrapper.unmount()
  wrappers.splice(wrappers.indexOf(wrapper), 1)
  expect(signal?.aborted).toBe(true)
  complete?.(schedule('p1'))
  await flushPromises()
  expect(workflow.saveModelingSchedule).not.toHaveBeenCalled()
  expect(workflow.getModelingSchedule).toHaveBeenCalledOnce()
})

async function unknownTraining(wrapper: VueWrapper): Promise<void> {
  vi.mocked(modeling.startModelingRun).mockRejectedValueOnce(
    new TransportError(0, '提交回执丢失'),
  )
  await flushPromises()
  await chooseAll(wrapper)
  await button(wrapper, '批量训练').trigger('click')
  await flushPromises()
}

it('批量结果未知后禁用单项写菜单与新建导入，读取导航仍可用', async () => {
  const wrapper = open()
  await unknownTraining(wrapper)
  await wrapper.get('input[type="search"]').setValue('another-scope')
  await wrapper.get('form').trigger('submit')
  await flushPromises()
  await button(wrapper, '下一页').trigger('click')
  await flushPromises()
  expect(wrapper.text()).toContain('结果待核查')
  expect(
    wrapper.get('button[aria-label="导入 JSON"]').attributes('disabled'),
  ).toBeDefined()
  expect(button(wrapper, '新建工作流').attributes('disabled')).toBeDefined()
  await wrapper
    .findAll('button[aria-label="工作流更多操作"]')[0]
    ?.trigger('click')
  await flushPromises()
  const items = wrapper.findAll('[role="menuitem"]')
  for (const item of items) {
    if (item.text() !== '导出 JSON')
      expect(item.attributes('disabled')).toBeDefined()
    if (item.text() === '删除工作流') await item.trigger('click')
  }
  expect(modeling.deleteModelingPipeline).not.toHaveBeenCalled()
  expect(button(wrapper, '打开工作流').attributes('disabled')).toBeUndefined()
})

it('结果未知后即使接收到迟到的单项事件也不打开写面或发请求', async () => {
  const wrapper = open()
  await unknownTraining(wrapper)
  const actions = wrapper.findAllComponents(PipelineActions)[0]
  if (!actions) throw new Error('缺少工作流操作')
  for (const event of [
    'schedule',
    'saveTemplate',
    'copy',
    'edit',
    'remove',
  ] as const) {
    actions.vm.$emit(event, pipeline('p1'))
  }
  const update = vi.spyOn(modeling, 'updateModelingPipeline')
  wrapper
    .getComponent(PipelineFormDialog)
    .vm.$emit(
      'submit',
      { id: 'p1', code: 'energy', name: '迟到修改', description: '' },
      '',
    )
  await flushPromises()
  expect(wrapper.getComponent(PipelineFormDialog).props('draft')).toBeNull()
  expect(wrapper.findComponent(PipelineBatchScheduleDialog).exists()).toBe(
    false,
  )
  expect(workflow.getModelingSchedule).not.toHaveBeenCalled()
  expect(modeling.deleteModelingPipeline).not.toHaveBeenCalled()
  expect(update).not.toHaveBeenCalled()
})

it('取消批量确认不会阻断单项写入口', async () => {
  ask.mockResolvedValueOnce(false)
  const wrapper = open()
  await flushPromises()
  await chooseAll(wrapper)
  await button(wrapper, '批量训练').trigger('click')
  await flushPromises()
  expect(modeling.startModelingRun).not.toHaveBeenCalled()
  expect(button(wrapper, '新建工作流').attributes('disabled')).toBeUndefined()
  await button(wrapper, '新建工作流').trigger('click')
  await flushPromises()
  expect(wrapper.getComponent(PipelineFormDialog).props('draft')).not.toBeNull()
})
