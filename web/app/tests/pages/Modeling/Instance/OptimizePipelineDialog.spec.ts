/** @fileoverview 结构优化复制实例保存图，并隔离失败、取消和切换后的响应。 */
import type { ModelingInstance, ModelingPipeline } from '@dt/contracts'
import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router'
import * as api from '@/api/modeling'
import { BizError } from '@/api/client'
import OptimizeDialog from '@/pages/Modeling/Instance/components/OptimizePipelineDialog.vue'
import { useAuthStore } from '@/stores/auth'

const navigation = vi.hoisted(() => ({ push: vi.fn() }))
vi.mock('vue-router', () => ({
  useRouter: () => navigation,
  onBeforeRouteLeave: vi.fn(),
  onBeforeRouteUpdate: vi.fn(),
}))
const instance: ModelingInstance = {
  id: 'model-snapshot',
  code: 'energy-model',
  name: '能耗模型',
  description: '原始模型说明',
  template_id: 'published-workflow-v1',
  template_name: '原工作流',
  template_version: 1,
  revision: 3,
  latest_run: null,
  created_at: '2026-10-30T00:00:00.000Z',
  updated_at: '2026-10-30T00:00:00.000Z',
}
const source: ModelingPipeline = {
  id: instance.id,
  code: instance.code,
  name: instance.name,
  description: instance.description,
  node_count: 1,
  source_table_codes: ['saved-energy'],
  created_by_name: '测试员',
  created_at: instance.created_at,
  updated_at: instance.updated_at,
  graph: {
    format_version: '1.0',
    nodes: [
      {
        id: 'saved-node',
        alias: '保存时的数据源',
        operator: 'ledger_source',
        config: {
          table_code: 'saved-energy',
          columns: ['原始温度'],
          row_limit: 99,
        },
        position: { left: 101, top: 202 },
      },
    ],
    edges: [],
  },
}
const created: ModelingPipeline = { ...source, id: 'new-design' }
const wrappers: VueWrapper[] = []

beforeEach(() => {
  setActivePinia(createPinia())
  vi.spyOn(useAuthStore(), 'can').mockReturnValue(true)
  vi.spyOn(api, 'getModelingPipeline').mockResolvedValue(source)
  vi.spyOn(api, 'createModelingPipeline').mockResolvedValue(created)
  navigation.push.mockReset()
  vi.mocked(onBeforeRouteLeave).mockClear()
  vi.mocked(onBeforeRouteUpdate).mockClear()
})
afterEach(() => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount()
  vi.restoreAllMocks()
})

function open(model: ModelingInstance | null = instance): VueWrapper {
  const wrapper = mount(OptimizeDialog, {
    props: { instance: model },
    global: { stubs: { teleport: true } },
  })
  wrappers.push(wrapper)
  return wrapper
}
function button(wrapper: VueWrapper, text = '创建并进入流程图') {
  const match = wrapper.findAll('button').find((item) => item.text() === text)
  if (!match) throw new Error(`没有按钮：${text}`)
  return match
}
async function fill(wrapper: VueWrapper): Promise<void> {
  await wrapper.findAll('input')[0]?.setValue('  节能优化设计  ')
  await wrapper.findAll('input')[1]?.setValue('Energy.optimized-1')
  await wrapper.get('textarea').setValue('新的优化目标')
}
function deferred<Value>() {
  let complete: ((value: Value) => void) | undefined
  const promise = new Promise<Value>((resolve) => {
    complete = resolve
  })
  return {
    promise,
    finish(value: Value) {
      if (!complete) throw new Error('尚未创建等待请求')
      complete(value)
    },
  }
}

it('复制实例保存的完整图与配置到独立设计，再进入新画布', async () => {
  const wrapper = open()
  await fill(wrapper)
  expect(wrapper.findAll('input').map((input) => input.element.value)).toEqual([
    '  节能优化设计  ',
    'Energy.optimized-1',
  ])
  expect(button(wrapper).attributes('disabled')).toBeUndefined()
  await button(wrapper).trigger('click')
  await flushPromises()
  expect(api.getModelingPipeline).toHaveBeenCalledWith(
    instance.id,
    expect.any(AbortSignal),
  )
  expect(api.createModelingPipeline).toHaveBeenCalledExactlyOnceWith({
    code: 'Energy.optimized-1',
    name: '节能优化设计',
    description: '新的优化目标',
    graph: source.graph,
  })
  expect(source.graph.nodes[0]?.config['row_limit']).toBe(99)
  expect(navigation.push).toHaveBeenCalledExactlyOnceWith(
    '/modeling/pipelines/new-design',
  )
  expect(wrapper.emitted('close')).toHaveLength(1)
})

it.each(['', '含空格 code', '_invalid', 'x'.repeat(65)])(
  '无效编码 %s 不能创建',
  async (code) => {
    const wrapper = open()
    await fill(wrapper)
    await wrapper.findAll('input')[1]?.setValue(code)
    expect(button(wrapper).attributes('disabled')).toBeDefined()
    await button(wrapper).trigger('click')
    expect(api.getModelingPipeline).not.toHaveBeenCalled()
  },
)

it('空白名称不能创建，空说明作为 null 保存', async () => {
  const wrapper = open()
  await fill(wrapper)
  await wrapper.findAll('input')[0]?.setValue('   ')
  expect(button(wrapper).attributes('disabled')).toBeDefined()
  await wrapper.findAll('input')[0]?.setValue('优化')
  await wrapper.get('textarea').setValue(' ')
  await button(wrapper).trigger('click')
  await flushPromises()
  expect(api.createModelingPipeline).toHaveBeenCalledWith(
    expect.objectContaining({ description: null }),
  )
})

it.each(['read', 'create'])(
  '创建阶段 %s 失败后保留用户填写值',
  async (stage) => {
    const failure = new BizError(41402, '这个编码已经被占用', 409, 'test-trace')
    if (stage === 'read')
      vi.mocked(api.getModelingPipeline).mockRejectedValueOnce(failure)
    else vi.mocked(api.createModelingPipeline).mockRejectedValueOnce(failure)
    const wrapper = open()
    await fill(wrapper)
    await button(wrapper).trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('这个编码已经被占用')
    expect(wrapper.findAll('input')[1]?.element.value).toBe(
      'Energy.optimized-1',
    )
    expect(wrapper.get('textarea').element.value).toBe('新的优化目标')
    expect(navigation.push).not.toHaveBeenCalled()
    await button(wrapper).trigger('click')
    await flushPromises()
    expect(navigation.push).toHaveBeenCalledWith(
      '/modeling/pipelines/new-design',
    )
  },
)

it('取消不会复制或创建流水线', async () => {
  const wrapper = open()
  await button(wrapper, '取消').trigger('click')
  expect(wrapper.emitted('close')).toHaveLength(1)
  expect(api.getModelingPipeline).not.toHaveBeenCalled()
  expect(api.createModelingPipeline).not.toHaveBeenCalled()
})

it('没有设计权限时没有创建弹窗', () => {
  vi.mocked(useAuthStore().can).mockReturnValue(false)
  const wrapper = open()
  expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
  expect(api.getModelingPipeline).not.toHaveBeenCalled()
})

it('复制期间不允许重复提交、关闭或切换路由，结束后解除保护', async () => {
  const pending = deferred<ModelingPipeline>()
  vi.mocked(api.getModelingPipeline).mockReturnValue(pending.promise)
  const wrapper = open()
  await fill(wrapper)
  await button(wrapper).trigger('click')
  expect(button(wrapper, '取消').attributes('disabled')).toBeDefined()
  await button(wrapper, '正在创建…').trigger('click')
  expect(api.getModelingPipeline).toHaveBeenCalledTimes(1)
  const leave = vi.mocked(onBeforeRouteLeave).mock.calls[0]?.[0]
  const update = vi.mocked(onBeforeRouteUpdate).mock.calls[0]?.[0]
  if (!leave || !update) throw new Error('缺少创建期间导航保护')
  const target = {
    params: {},
    fullPath: '/',
    path: '/',
    query: {},
    hash: '',
    name: 'home',
    matched: [],
    meta: {},
    redirectedFrom: undefined,
  }
  expect(await leave(target, target, vi.fn())).toBe(false)
  expect(await update(target, target, vi.fn())).toBe(false)
  pending.finish(source)
  await flushPromises()
  expect(await leave(target, target, vi.fn())).toBe(true)
})

it('关闭状态不发请求，打开后回填当前模型名称和说明', async () => {
  const wrapper = open(null)
  expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
  await wrapper.setProps({ instance })
  expect(wrapper.findAll('input')[0]?.element.value).toBe('能耗模型 优化')
  expect(wrapper.get('textarea').element.value).toBe('原始模型说明')
})

it.each(['unmount', 'switch'])(
  '读快照期间 %s 不会继续创建或导航',
  async (action) => {
    const pending = deferred<ModelingPipeline>()
    vi.mocked(api.getModelingPipeline).mockReturnValue(pending.promise)
    const wrapper = open()
    await fill(wrapper)
    await button(wrapper).trigger('click')
    if (action === 'unmount') wrapper.unmount()
    else
      await wrapper.setProps({ instance: { ...instance, id: 'other-model' } })
    pending.finish(source)
    await flushPromises()
    expect(api.createModelingPipeline).not.toHaveBeenCalled()
    expect(navigation.push).not.toHaveBeenCalled()
  },
)

it.each(['close', 'switch', 'unmount'])(
  '创建期间 %s 后忽略旧创建结果',
  async (action) => {
    const pending = deferred<ModelingPipeline>()
    vi.mocked(api.createModelingPipeline).mockReturnValue(pending.promise)
    const wrapper = open()
    await fill(wrapper)
    await button(wrapper).trigger('click')
    await flushPromises()
    if (action === 'unmount') wrapper.unmount()
    else if (action === 'close') await wrapper.setProps({ instance: null })
    else
      await wrapper.setProps({ instance: { ...instance, id: 'other-model' } })
    pending.finish(created)
    await flushPromises()
    expect(navigation.push).not.toHaveBeenCalled()
    expect(wrapper.emitted('close')).toBeUndefined()
  },
)
