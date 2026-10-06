/** @fileoverview 建模脏稿通过真实路由离开、取消、返回及刷新保护。 */
import { PERMISSION_CODES } from '@dt/contracts'
import type {
  ModelingOperator,
  ModelingPipeline,
  ModelingRun,
} from '@dt/contracts'
import { useConfirm } from '@dt/ui'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'

import * as modeling from '@/api/modeling'
import CanvasPage from '@/pages/Modeling/Canvas/index.vue'
import { useAuthStore } from '@/stores/auth'

const STAMP = '2026-01-01T00:00:00.000Z'
const PIPELINE: ModelingPipeline = {
  id: 'p1',
  code: 'test',
  name: '测试流水线',
  description: null,
  node_count: 0,
  source_table_codes: [],
  created_by_name: null,
  created_at: STAMP,
  updated_at: STAMP,
  graph: { format_version: '1', nodes: [], edges: [] },
}
const OPERATOR: ModelingOperator = {
  code: 'test',
  name: '测试算子',
  description: '',
  category: 'source',
  spec_version: '1',
  icon: 'table',
  inputs: [],
  outputs: [],
  config_schema: {},
  fit_required: false,
  serving_enabled: false,
  serving_window_required: false,
  serving_channel: 'json',
}
const mounted: { unmount: () => void }[] = []
const RUN: ModelingRun = {
  id: 'r1',
  pipeline_id: 'p1',
  status: 'running',
  trigger: 'manual',
  started_at: STAMP,
  finished_at: null,
  duration_ms: null,
  row_count: null,
  is_source_truncated: false,
  is_keeping_frames: false,
  error_text: null,
  created_by_name: null,
  created_at: STAMP,
  graph: PIPELINE.graph,
  nodes: [],
}

beforeEach(() => {
  setActivePinia(createPinia())
  const auth = useAuthStore()
  const permissions = [
    PERMISSION_CODES.modelingView,
    PERMISSION_CODES.modelingManage,
    PERMISSION_CODES.modelingRun,
  ]
  auth.user = {
    id: 'test',
    username: 'test',
    email: 'test@example.test',
    full_name: null,
    avatar_url: null,
    phone: null,
    is_active: true,
    last_login_at: null,
    created_at: STAMP,
    updated_at: STAMP,
    role: { id: 'test', name: 'test', description: null, is_builtin: false },
    role_permissions: permissions,
    direct_permissions: [],
    permissions,
  }
  auth.accessToken = 'test-token'
  vi.spyOn(modeling, 'listModelingOperators').mockResolvedValue([OPERATOR])
  vi.spyOn(modeling, 'getModelingPipeline').mockResolvedValue(PIPELINE)
  vi.spyOn(modeling, 'listModelingRuns').mockResolvedValue({
    items: [],
    page: 1,
    size: 50,
    total: 0,
  })
  vi.spyOn(modeling, 'validateModelingGraph').mockResolvedValue({
    is_valid: true,
    issues: [],
    known_columns: {},
  })
})
afterEach(() => {
  useConfirm().resolve(false)
  while (mounted.length > 0) mounted.pop()?.unmount()
  vi.restoreAllMocks()
})

async function open(path = '/modeling/pipelines/p1', isAddingNode = true) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/modeling/pipelines/:pipelineId', component: CanvasPage },
      { path: '/workbench', component: { template: '<div>工作台</div>' } },
      { path: '/', component: { template: '<div>首页</div>' } },
      { path: '/profile', component: { template: '<div>个人资料</div>' } },
      {
        path: '/modeling/pipelines',
        component: { template: '<div>流水线</div>' },
      },
    ],
  })
  await router.push('/workbench')
  await router.push(path)
  const wrapper = mount(RouterView, {
    attachTo: document.body,
    global: { plugins: [router], stubs: { Teleport: true } },
  })
  mounted.push(wrapper)
  await flushPromises()
  if (isAddingNode) await wrapper.find('.dt-ml-palette__item').trigger('click')
  return { router, wrapper }
}

describe('普通未保存画布离开', () => {
  it('p2文档先回来但历史未完成时不开放旧算子，完成后新编辑不会被重置', async () => {
    vi.mocked(modeling.getModelingPipeline).mockImplementation((id) =>
      Promise.resolve({ ...PIPELINE, id, name: id }),
    )
    let finish: (value: {
      items: []
      page: number
      size: number
      total: number
    }) => void = () => undefined
    vi.mocked(modeling.listModelingRuns).mockImplementation((id) =>
      id === 'p2'
        ? new Promise((resolve) => {
            finish = resolve
          })
        : Promise.resolve({ items: [], page: 1, size: 50, total: 0 }),
    )
    const { router, wrapper } = await open('/modeling/pipelines/p1', false)
    await router.push('/modeling/pipelines/p2')
    await flushPromises()
    const palette = wrapper.find('.dt-ml-palette__item')
    const wasEditable = palette.exists()
    if (wasEditable) {
      await palette.trigger('click')
      expect(wrapper.findAll('.dt-ml-node')).toHaveLength(1)
    }
    finish({ items: [], page: 1, size: 50, total: 0 })
    await flushPromises()
    expect(wasEditable).toBe(false)
    await wrapper.find('.dt-ml-palette__item').trigger('click')
    expect(wrapper.findAll('.dt-ml-node')).toHaveLength(1)
  })

  it('带run_id的初始加载未完成就卸载，不再发起历史恢复', async () => {
    let finish: (value: {
      items: []
      page: number
      size: number
      total: number
    }) => void = () => undefined
    vi.mocked(modeling.listModelingRuns).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    const getRun = vi.spyOn(modeling, 'getModelingRun').mockResolvedValue(RUN)
    const { wrapper } = await open('/modeling/pipelines/p1?run_id=r1', false)
    wrapper.unmount()
    finish({ items: [], page: 1, size: 50, total: 0 })
    await flushPromises()
    expect(getRun).not.toHaveBeenCalled()
  })

  it('p1历史恢复已在飞时切p2，迟到结果不恢复旧运行', async () => {
    vi.mocked(modeling.getModelingPipeline).mockImplementation((id) =>
      Promise.resolve({ ...PIPELINE, id, name: id }),
    )
    let finish: (value: ModelingRun) => void = () => undefined
    vi.spyOn(modeling, 'getModelingRun').mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    const { router, wrapper } = await open(
      '/modeling/pipelines/p1?run_id=r1',
      false,
    )
    await router.push('/modeling/pipelines/p2')
    await flushPromises()
    finish(RUN)
    await flushPromises()
    expect(wrapper.text()).not.toContain('取消运行')
    expect(wrapper.text()).toContain('p2')
  })

  it('其它流水线的run_id不会恢复到当前画布', async () => {
    vi.spyOn(modeling, 'getModelingRun').mockResolvedValue({
      ...RUN,
      pipeline_id: 'p2',
    })
    const { wrapper } = await open('/modeling/pipelines/p1?run_id=r2', false)
    await flushPromises()
    expect(wrapper.text()).not.toContain('取消运行')
  })

  it('已发起p1运行的迟到回执不在p2恢复旧运行或轮询', async () => {
    vi.mocked(modeling.getModelingPipeline).mockImplementation((id) =>
      Promise.resolve({ ...PIPELINE, id, name: id }),
    )
    vi.spyOn(modeling, 'updateModelingPipeline').mockImplementation(
      (id, patch) =>
        Promise.resolve({
          ...PIPELINE,
          id,
          graph: patch.graph ?? PIPELINE.graph,
        }),
    )
    let finish: (value: ModelingRun) => void = () => undefined
    vi.spyOn(modeling, 'startModelingRun').mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const getRun = vi.spyOn(modeling, 'getModelingRun').mockResolvedValue(RUN)
    const { router, wrapper } = await open()
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '运行')
      ?.trigger('click')
    await flushPromises()
    await router.push('/modeling/pipelines/p2')
    await flushPromises()
    finish(RUN)
    await flushPromises()
    expect(wrapper.text()).toContain('p2')
    expect(wrapper.text()).not.toContain('取消运行')
    expect(getRun).not.toHaveBeenCalled()
  })

  it('p1运行保存迟到不污染p2，也不启动p2；p2仍可保存自己的新图', async () => {
    vi.mocked(modeling.getModelingPipeline).mockImplementation((id) =>
      Promise.resolve({ ...PIPELINE, id, name: id }),
    )
    let finish: (value: ModelingPipeline) => void = () => undefined
    const update = vi
      .spyOn(modeling, 'updateModelingPipeline')
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve
          }),
      )
    const start = vi.spyOn(modeling, 'startModelingRun').mockResolvedValue(RUN)
    const { router, wrapper } = await open()
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '运行')
      ?.trigger('click')
    const switching = router.push('/modeling/pipelines/p2')
    await flushPromises()
    useConfirm().resolve(true)
    await switching
    await flushPromises()
    await wrapper.find('.dt-ml-palette__item').trigger('click')
    vi.mocked(modeling.validateModelingGraph).mockClear()
    finish({
      ...PIPELINE,
      graph: update.mock.calls[0]?.[1].graph ?? PIPELINE.graph,
    })
    await flushPromises()
    expect(wrapper.text()).toContain('p2')
    expect(wrapper.findAll('.dt-ml-node')).toHaveLength(1)
    expect(start).not.toHaveBeenCalled()
    expect(modeling.validateModelingGraph).not.toHaveBeenCalled()
    update.mockImplementationOnce((id, patch) =>
      Promise.resolve({
        ...PIPELINE,
        id,
        name: id,
        graph: patch.graph ?? PIPELINE.graph,
      }),
    )
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '保存')
      ?.trigger('click')
    await flushPromises()
    expect(update.mock.calls[1]?.[0]).toBe('p2')
    expect(update.mock.calls[1]?.[1].graph?.nodes).toHaveLength(1)
  })

  it('运行保存未返回时确认离开，迟到保存不校验、不起运行、不拉历史', async () => {
    let finish: (value: ModelingPipeline) => void = () => undefined
    const update = vi
      .spyOn(modeling, 'updateModelingPipeline')
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve
          }),
      )
    const start = vi.spyOn(modeling, 'startModelingRun').mockResolvedValue(RUN)
    const { router, wrapper } = await open()
    vi.mocked(modeling.validateModelingGraph).mockClear()
    vi.mocked(modeling.listModelingRuns).mockClear()
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '运行')
      ?.trigger('click')
    const leaving = router.push('/workbench')
    await flushPromises()
    useConfirm().resolve(true)
    await leaving
    await flushPromises()
    finish({
      ...PIPELINE,
      graph: update.mock.calls[0]?.[1].graph ?? PIPELINE.graph,
    })
    await flushPromises()
    expect(modeling.validateModelingGraph).not.toHaveBeenCalled()
    expect(start).not.toHaveBeenCalled()
    expect(modeling.listModelingRuns).not.toHaveBeenCalled()
  })

  it('同组件切流水线先确认，取消保留p1草稿，确认后只加载p2', async () => {
    const get = vi
      .mocked(modeling.getModelingPipeline)
      .mockImplementation((id) =>
        Promise.resolve({ ...PIPELINE, id, name: id }),
      )
    const { router, wrapper } = await open()
    const cancelled = router.push('/modeling/pipelines/p2')
    await flushPromises()
    expect(useConfirm().pending.value?.message).toContain('未保存')
    useConfirm().resolve(false)
    await cancelled
    expect(router.currentRoute.value.params['pipelineId']).toBe('p1')
    expect(wrapper.findAll('.dt-ml-node')).toHaveLength(1)
    expect(get).toHaveBeenCalledTimes(1)
    const confirmed = router.push('/modeling/pipelines/p2')
    await flushPromises()
    useConfirm().resolve(true)
    await confirmed
    await flushPromises()
    expect(get).toHaveBeenLastCalledWith('p2', expect.any(AbortSignal))
    expect(wrapper.text()).toContain('p2')
    expect(wrapper.findAll('.dt-ml-node')).toHaveLength(0)
  })

  it('浏览器返回取消保留草稿，刷新仅脏时拦截，卸载清除监听', async () => {
    const { router, wrapper } = await open()
    const dirtyUnload = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(dirtyUnload)
    expect(dirtyUnload.defaultPrevented).toBe(true)
    router.back()
    await flushPromises()
    expect(useConfirm().pending.value).not.toBeNull()
    useConfirm().resolve(false)
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/modeling/pipelines/p1')
    expect(wrapper.findAll('.dt-ml-node')).toHaveLength(1)
    await wrapper.find('button[title="撤销（⌘Z）"]').trigger('click')
    await flushPromises()
    expect(wrapper.findAll('.dt-ml-node')).toHaveLength(0)
    const cleanUnload = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(cleanUnload)
    expect(cleanUnload.defaultPrevented).toBe(false)
    await router.push('/workbench')
    expect(useConfirm().pending.value).toBeNull()
    await flushPromises()
    const afterLeave = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(afterLeave)
    expect(afterLeave.defaultPrevented).toBe(false)
  })

  it('无需保存竞态也会询问；取消保持图和保存按钮，确认才离开', async () => {
    const { router, wrapper } = await open()
    const leaving = router.push('/workbench')
    await flushPromises()
    expect(useConfirm().pending.value?.message).toContain('未保存')
    expect(router.currentRoute.value.path).toBe('/modeling/pipelines/p1')
    useConfirm().resolve(false)
    await leaving
    await flushPromises()
    expect(wrapper.findAll('.dt-ml-node')).toHaveLength(1)
    expect(
      wrapper
        .findAll('button')
        .find((button) => button.text() === '保存')
        ?.attributes('disabled'),
    ).toBeUndefined()
    const confirmed = router.push('/workbench')
    await flushPromises()
    useConfirm().resolve(true)
    await confirmed
    expect(router.currentRoute.value.path).toBe('/workbench')
  })
})
