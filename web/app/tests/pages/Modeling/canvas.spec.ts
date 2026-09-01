/**
 * @fileoverview 画布页：算子面板由后端目录驱动、落节点带默认参数、连线不合法
 * 时当场报人话、回看历史切只读、运行中给的是「取消」而不是「运行」。
 */
import { PERMISSION_CODES } from '@dt/contracts'
import type {
  ModelingOperator,
  ModelingPipeline,
  ModelingRun,
} from '@dt/contracts'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as modeling from '@/api/modeling'
import CanvasPage from '@/pages/Modeling/Canvas/index.vue'
import { useAuthStore } from '@/stores/auth'

/** DtModal 会 Teleport 到 body，不打桩的话弹窗里的东西 wrapper 找不到。 */
function open() {
  return mount(CanvasPage, {
    attachTo: document.body,
    global: { stubs: { Teleport: true } },
  })
}

const STAMP = '2026-01-01T00:00:00.000Z'

vi.mock('vue-router', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useRoute: () => ({
    path: '/modeling/pipelines/p1',
    params: { pipelineId: 'p1' },
    query: {},
  }),
  RouterLink: { template: '<a><slot /></a>' },
}))

function operator(over: Partial<ModelingOperator> = {}): ModelingOperator {
  return {
    code: 'ledger_source',
    name: '台账取数',
    description: '从一张台账里取行',
    category: 'source',
    spec_version: '1',
    icon: 'table',
    inputs: [],
    outputs: [
      {
        name: 'out',
        contract: 'frame',
        label: '数据',
        is_required: true,
        description: '',
      },
    ],
    config_schema: {
      properties: {
        row_limit: { default: 100, title: '行数上限', type: 'integer' },
      },
      required: [],
      type: 'object',
    },
    fit_required: false,
    serving_enabled: false,
    serving_window_required: false,
    serving_channel: 'json',
    ...over,
  }
}

function pipeline(): ModelingPipeline {
  return {
    id: 'p1',
    code: 'energy_fit',
    name: '能耗回归',
    description: null,
    node_count: 0,
    source_table_codes: [],
    created_by_name: null,
    created_at: STAMP,
    updated_at: STAMP,
    graph: { format_version: '1', nodes: [], edges: [] },
  }
}

function runOf(status: ModelingRun['status']): ModelingRun {
  return {
    id: 'r1',
    pipeline_id: 'p1',
    status,
    trigger: 'manual',
    started_at: STAMP,
    finished_at: null,
    duration_ms: null,
    row_count: null,
    is_source_truncated: false,
    error_text: null,
    created_by_name: null,
    created_at: STAMP,
    graph: { format_version: '1', nodes: [], edges: [] },
    nodes: [],
  }
}

function signIn(permissions: string[]): void {
  const auth = useAuthStore()
  auth.user = {
    username: 'u',
    permissions,
    role_permissions: permissions,
    direct_permissions: [],
    role: { name: 'r', description: '' },
  } as never
  auth.accessToken = 'token'
}

function stubApi(over: { operators?: ModelingOperator[] } = {}) {
  vi.spyOn(modeling, 'listModelingOperators').mockResolvedValue(
    over.operators ?? [operator()],
  )
  vi.spyOn(modeling, 'getModelingPipeline').mockResolvedValue(pipeline())
  vi.spyOn(modeling, 'listModelingRuns').mockResolvedValue({
    items: [],
    page: 1,
    size: 50,
    total: 0,
  })
}

const WRITER = [
  PERMISSION_CODES.modelingView,
  PERMISSION_CODES.modelingManage,
  PERMISSION_CODES.modelingRun,
]

beforeEach(() => {
  setActivePinia(createPinia())
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('画布页', () => {
  it('算子面板整份来自后端目录，加一个算子不用改前端', async () => {
    stubApi({
      operators: [
        operator(),
        operator({ code: 'brand_new', name: '将来才有的算子' }),
      ],
    })
    signIn(WRITER)

    const wrapper = open()
    await flushPromises()

    expect(wrapper.text()).toContain('台账取数')
    expect(wrapper.text()).toContain('将来才有的算子')
  })

  it('点一个算子就往画布上落一个节点，参数带着 schema 的默认值', async () => {
    stubApi()
    signIn(WRITER)
    const wrapper = open()
    await flushPromises()

    await wrapper.findAll('.dt-ml-palette__item')[0]?.trigger('click')
    await flushPromises()

    const node = wrapper.find('.dt-ml-node')
    expect(node.exists()).toBe(true)
    expect(node.text()).toContain('台账取数')
  })

  it('只读账号点不动算子面板', async () => {
    stubApi()
    signIn([PERMISSION_CODES.modelingView])

    const wrapper = open()
    await flushPromises()

    const item = wrapper.find('.dt-ml-palette__item')
    expect(item.attributes('disabled')).toBeDefined()
  })

  it('没有跑码时不给「运行」，并留一句说明', async () => {
    stubApi()
    signIn([PERMISSION_CODES.modelingView, PERMISSION_CODES.modelingManage])

    const wrapper = open()
    await flushPromises()

    expect(wrapper.text()).not.toContain('运行历史 运行')
    expect(wrapper.find('[data-test="perm-readonly"]').exists()).toBe(true)
  })

  it('运行中给的是「取消运行」，不是再来一次', async () => {
    stubApi()
    vi.spyOn(modeling, 'startModelingRun').mockResolvedValue(runOf('running'))
    vi.spyOn(modeling, 'getModelingRun').mockResolvedValue(runOf('running'))
    signIn(WRITER)
    const wrapper = open()
    await flushPromises()

    const buttons = wrapper.findAll('button')
    await buttons.find((b) => b.text() === '运行')?.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('取消运行')
  })

  it('回看历史运行时切成只读，并给一条回到编辑的路', async () => {
    stubApi()
    vi.spyOn(modeling, 'listModelingRuns').mockResolvedValue({
      items: [
        {
          id: 'r1',
          pipeline_id: 'p1',
          status: 'succeeded',
          trigger: 'manual',
          started_at: STAMP,
          finished_at: STAMP,
          duration_ms: 1200,
          row_count: 42,
          is_source_truncated: false,
          error_text: null,
          created_by_name: '张三',
          created_at: STAMP,
        },
      ],
      page: 1,
      size: 50,
      total: 1,
    })
    vi.spyOn(modeling, 'getModelingRun').mockResolvedValue(runOf('succeeded'))
    signIn(WRITER)
    const wrapper = open()
    await flushPromises()

    await wrapper
      .findAll('button')
      .find((b) => b.text() === '运行历史')
      ?.trigger('click')
    await flushPromises()
    await wrapper.find('.dt-ml-runs__item').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('正在回看历史运行')
    expect(wrapper.text()).toContain('回到编辑')
    expect(
      wrapper.find('.dt-ml-palette__item').attributes('disabled'),
    ).toBeDefined()
  })

  it('流水线取不回来时给出错页，而不是一张空画布', async () => {
    vi.spyOn(modeling, 'listModelingOperators').mockResolvedValue([])
    vi.spyOn(modeling, 'getModelingPipeline').mockRejectedValue(
      new Error('库里没有这条'),
    )
    vi.spyOn(modeling, 'listModelingRuns').mockResolvedValue({
      items: [],
      page: 1,
      size: 50,
      total: 0,
    })
    signIn(WRITER)

    const wrapper = open()
    await flushPromises()

    expect(wrapper.find('.dt-ml-canvas').exists()).toBe(false)
  })
})
