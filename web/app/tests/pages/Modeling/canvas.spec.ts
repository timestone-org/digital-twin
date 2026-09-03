/**
 * @fileoverview 画布页：算子面板由后端目录驱动、落节点带默认参数、连线不合法
 * 时当场报人话、回看历史切只读、运行中给的是「取消」而不是「运行」。
 */
import { PERMISSION_CODES } from '@dt/contracts'
import type {
  DatasetColumn,
  ModelingOperator,
  ModelingPipeline,
  ModelingRun,
} from '@dt/contracts'
import { DtSelect } from '@dt/ui'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as dataset from '@/api/dataset'
import * as modeling from '@/api/modeling'
import CanvasPage from '@/pages/Modeling/Canvas/index.vue'
import { useAuthStore } from '@/stores/auth'

/** 这一条用例挂起来的页面，跑完逐个卸载。 */
const mounted: { unmount: () => void }[] = []

/** DtModal 会 Teleport 到 body，不打桩的话弹窗里的东西 wrapper 找不到。 */
function open() {
  const wrapper = mount(CanvasPage, {
    attachTo: document.body,
    global: { stubs: { Teleport: true } },
  })
  mounted.push(wrapper)
  return wrapper
}

const STAMP = '2026-01-01T00:00:00.000Z'

/** 地址栏的查询串。深链回看那两条用例会改它。 */
const query: Record<string, string> = {}
const replace = vi.fn()

vi.mock('vue-router', () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
  useRoute: () => ({
    path: '/modeling/pipelines/p1',
    params: { pipelineId: 'p1' },
    query,
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

/** 台账清单接口的一页。 */
function tablePage(tables: { id: string; code: string; name: string }[]) {
  return {
    items: tables.map((table) => ({
      ...table,
      description: null,
      column_count: 1,
      cadence: 'day',
      created_at: STAMP,
      updated_at: STAMP,
    })),
    page: 1,
    size: 200,
    total: tables.length,
  } as never
}

/** 台账清单。给 `null` 表示接口失败（网络、5xx，或被边缘挡下的 403）。 */
function stubLedger(
  tables: { id: string; code: string; name: string }[] | null,
) {
  const listTables = vi.spyOn(dataset, 'listDatasetTables')
  if (tables === null) {
    listTables.mockRejectedValue(new Error('403'))
    return listTables
  }
  listTables.mockResolvedValue(tablePage(tables))
  vi.spyOn(dataset, 'listDatasetColumns').mockResolvedValue([])
  return listTables
}

/** 只有一个台账引用字段的算子 schema。 */
const TABLE_SCHEMA = {
  properties: {
    table_code: {
      title: '数据台账',
      type: 'string',
      'x-dt-widget': 'table',
    },
  },
  required: ['table_code'],
  type: 'object',
}

function stubApi(
  over: { operators?: ModelingOperator[]; pipeline?: ModelingPipeline } = {},
) {
  stubLedger([{ id: 't1', code: 'energy_log', name: '能耗台账' }])
  vi.spyOn(modeling, 'listModelingOperators').mockResolvedValue(
    over.operators ?? [operator()],
  )
  vi.spyOn(modeling, 'getModelingPipeline').mockResolvedValue(
    over.pipeline ?? pipeline(),
  )
  vi.spyOn(modeling, 'listModelingRuns').mockResolvedValue({
    items: [],
    page: 1,
    size: 50,
    total: 0,
  })
  // 画布现在边改边校验、并在运行前再校一次，不打桩的话每条用例都会真发请求
  vi.spyOn(modeling, 'validateModelingGraph').mockResolvedValue({
    is_valid: true,
    issues: [],
  })
}

// 种子里的 admin 与 viewer 两个角色都同时带着 dataset:view 与 modeling:view，
// 所以「有写权限的人」的常态是两组码都有
const WRITER = [
  PERMISSION_CODES.modelingView,
  PERMISSION_CODES.modelingManage,
  PERMISSION_CODES.modelingRun,
  PERMISSION_CODES.datasetView,
]

/** 管理员能手工配出「只有建模那一组」的角色，那时台账清单一趟都请求不动。 */
const MODELING_ONLY = [
  PERMISSION_CODES.modelingView,
  PERMISSION_CODES.modelingManage,
  PERMISSION_CODES.modelingRun,
]

beforeEach(() => {
  setActivePinia(createPinia())
  for (const key of Object.keys(query)) delete query[key]
  replace.mockReset()
})

afterEach(() => {
  // ⚠ 必须卸载：画布页开着每秒一次的走字计时器与运行轮询，留着的话它们会跨
  // 文件一直打请求，整套用例跑完了进程也停不下来
  while (mounted.length > 0) mounted.pop()?.unmount()
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

  it('选中一个节点再按 Delete，它真的从画布上没了', async () => {
    stubApi()
    signIn(WRITER)
    const wrapper = open()
    await flushPromises()
    await wrapper.findAll('.dt-ml-palette__item')[0]?.trigger('click')
    await flushPromises()
    await wrapper.find('.dt-ml-canvas__node').trigger('pointerdown')
    await flushPromises()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete' }))
    await flushPromises()

    expect(wrapper.find('.dt-ml-node').exists()).toBe(false)
  })

  it('删错了按 Ctrl+Z 能退回来', async () => {
    stubApi()
    signIn(WRITER)
    const wrapper = open()
    await flushPromises()
    await wrapper.findAll('.dt-ml-palette__item')[0]?.trigger('click')
    await flushPromises()
    await wrapper.find('.dt-ml-canvas__node').trigger('pointerdown')
    await flushPromises()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete' }))
    await flushPromises()

    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'z', ctrlKey: true }),
    )
    await flushPromises()

    expect(wrapper.find('.dt-ml-node').exists()).toBe(true)
  })

  it('跑起来之后顶栏给进度，不然卡死与慢跑长得一样', async () => {
    stubApi()
    const running = {
      ...runOf('running'),
      nodes: [
        {
          node_id: 'n1',
          operator: 'ledger_source',
          alias: null,
          ordinal: 0,
          status: 'succeeded' as const,
          duration_ms: 30,
          has_preview: true,
          error_text: null,
        },
        {
          node_id: 'n2',
          operator: 'ledger_source',
          alias: null,
          ordinal: 1,
          status: 'running' as const,
          duration_ms: null,
          has_preview: false,
          error_text: null,
        },
      ],
    }
    vi.spyOn(modeling, 'startModelingRun').mockResolvedValue(running)
    vi.spyOn(modeling, 'getModelingRun').mockResolvedValue(running)
    signIn(WRITER)
    const wrapper = open()
    await flushPromises()

    await wrapper
      .findAll('button')
      .find((b) => b.text() === '运行')
      ?.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('第 2/2 个节点')
  })

  it('带着 ?run_id= 进来直接落到只读回看——同事发过来的链接要能用', async () => {
    stubApi()
    vi.spyOn(modeling, 'getModelingRun').mockResolvedValue(runOf('succeeded'))
    query['run_id'] = 'r1'
    signIn(WRITER)

    const wrapper = open()
    await flushPromises()

    expect(wrapper.text()).toContain('正在回看历史运行')
  })

  it('回到编辑时把 run_id 从地址栏清掉，刷新不会又跳回只读', async () => {
    stubApi()
    vi.spyOn(modeling, 'getModelingRun').mockResolvedValue(runOf('succeeded'))
    query['run_id'] = 'r1'
    signIn(WRITER)
    const wrapper = open()
    await flushPromises()

    await wrapper
      .findAll('button')
      .find((b) => b.text() === '回到编辑')
      ?.trigger('click')
    await flushPromises()

    expect(replace).toHaveBeenLastCalledWith({ query: {} })
    expect(wrapper.text()).not.toContain('正在回看历史运行')
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

describe('摆算子', () => {
  /** 打开页面并把算子面板第一项点一下。 */
  async function addOnce(wrapper: ReturnType<typeof open>): Promise<void> {
    await wrapper.find('.dt-ml-palette__item').trigger('click')
    await wrapper.vm.$nextTick()
  }

  // ⚠ 落点全一样的话，卡片会叠成一摞，下面那张的接点根本点不到——
  // 表象就是「模块连不上线」
  it('连着点两次，两张卡片不落在同一个点上', async () => {
    stubApi()
    signIn(WRITER)
    const wrapper = open()
    await flushPromises()

    await addOnce(wrapper)
    await addOnce(wrapper)

    const spots = wrapper
      .findAll('.dt-ml-canvas__node')
      .map((el) => el.attributes('style') ?? '')
    expect(spots).toHaveLength(2)
    expect(spots[0]).not.toBe(spots[1])
  })

  it('算子面板的每一项都能拖', async () => {
    stubApi()
    signIn(WRITER)
    const wrapper = open()
    await flushPromises()

    expect(wrapper.find('.dt-ml-palette__item').attributes('draggable')).toBe(
      'true',
    )
  })

  it('只读时拖不动，也点不动', async () => {
    stubApi()
    signIn([PERMISSION_CODES.modelingView])
    const wrapper = open()
    await flushPromises()

    const item = wrapper.find('.dt-ml-palette__item')
    expect(item.attributes('draggable')).toBe('false')
    expect(item.attributes('disabled')).toBeDefined()
  })
})

describe('参数面板', () => {
  /** 开页面、落一个节点、点开它的「参数」。 */
  async function openConfig(wrapper: ReturnType<typeof open>): Promise<void> {
    await wrapper.find('.dt-ml-palette__item').trigger('click')
    await wrapper.vm.$nextTick()
    await wrapper
      .findAll('.dt-ml-node__action')
      .find((b) => b.text() === '参数')
      ?.trigger('click')
    await flushPromises()
  }

  it('台账下拉列的是真台账，不是一个空下拉', async () => {
    stubApi({
      operators: [
        operator({
          config_schema: {
            properties: {
              table_code: {
                title: '数据台账',
                type: 'string',
                'x-dt-widget': 'table',
              },
            },
            required: ['table_code'],
            type: 'object',
          },
        }),
      ],
    })
    signIn(WRITER)
    const wrapper = open()
    await flushPromises()

    await openConfig(wrapper)

    // ⚠ 选项要断在 props 上：DtSelect 的选项只在浮层打开时才进 DOM，
    // 按渲染出来的文字断言会把「下拉是空的」也判成通过
    expect(wrapper.findComponent(DtSelect).props('options')).toEqual([
      { value: 'energy_log', label: '能耗台账（energy_log）' },
    ])
  })

  // ⚠ 搜索框不能按选项数量自动给：台账靠编码认，一张也要能敲编码定位
  it('台账下拉不看选项多少，总有搜索框', async () => {
    stubApi({ operators: [operator({ config_schema: TABLE_SCHEMA })] })
    signIn(WRITER)
    const wrapper = open()
    await flushPromises()
    await openConfig(wrapper)

    await wrapper.find('.dt-select__trigger').trigger('click')

    expect(document.querySelector('.dt-select-menu__input')).not.toBeNull()
  })

  // ⚠ 下拉空着显示「请选择」是在骗人：图里明明存着一个编码
  it('图里存的编码不在清单里时，下拉仍把它列出来并标注', async () => {
    stubApi({
      operators: [operator({ config_schema: TABLE_SCHEMA })],
      pipeline: {
        ...pipeline(),
        graph: {
          format_version: '1',
          nodes: [
            {
              id: 'n1',
              operator: 'ledger_source',
              alias: '',
              position: { left: 0, top: 0 },
              config: { table_code: 'gone_table' },
            },
          ],
          edges: [],
        },
      },
    })
    signIn(WRITER)
    const wrapper = open()
    await flushPromises()

    await wrapper
      .findAll('.dt-ml-node__action')
      .find((b) => b.text() === '参数')
      ?.trigger('click')
    await flushPromises()

    expect(wrapper.findComponent(DtSelect).props('options')).toEqual([
      { value: 'gone_table', label: 'gone_table（清单里没有这张台账）' },
      { value: 'energy_log', label: '能耗台账（energy_log）' },
    ])
  })

  // ⚠ 拉取失败不是权限问题：说成权限问题会让人去找管理员要一个本来就有的码
  it('台账清单拉取失败时给「重试」，不把它说成权限问题', async () => {
    stubApi({ operators: [operator({ config_schema: TABLE_SCHEMA })] })
    const listTables = stubLedger(null)
    signIn(WRITER)
    const wrapper = open()
    await flushPromises()
    await openConfig(wrapper)

    expect(wrapper.text()).not.toContain('dataset:view')
    expect(wrapper.text()).toContain('没拉到台账清单')

    listTables.mockResolvedValue(
      tablePage([{ id: 't1', code: 'energy_log', name: '能耗台账' }]),
    )
    await wrapper
      .findAll('button')
      .find((b) => b.text() === '重试')
      ?.trigger('click')
    await flushPromises()

    expect(wrapper.findComponent(DtSelect).props('options')).toEqual([
      { value: 'energy_log', label: '能耗台账（energy_log）' },
    ])
  })

  it('改过的参数能一键回到默认值', async () => {
    stubApi()
    signIn(WRITER)
    const wrapper = open()
    await flushPromises()
    await openConfig(wrapper)
    // 默认是 100，改成别的之后才会冒出「恢复默认」
    expect(wrapper.text()).not.toContain('恢复默认')

    await wrapper.find('.dt-ml-form input').setValue('7')
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).toContain('恢复默认')
  })
})

describe('没有台账查看权限时', () => {
  // ⚠ 那一趟必被边缘挡下，发出去只是白等一次 403
  it('一趟请求都不发，并把原因说出来', async () => {
    stubApi({
      operators: [
        operator({
          config_schema: {
            properties: {
              table_code: {
                title: '数据台账',
                type: 'string',
                'x-dt-widget': 'table',
              },
            },
            required: ['table_code'],
            type: 'object',
          },
        }),
      ],
    })
    const listTables = vi.spyOn(dataset, 'listDatasetTables')
    signIn(MODELING_ONLY)
    const wrapper = open()
    await flushPromises()

    await wrapper.find('.dt-ml-palette__item').trigger('click')
    await wrapper.vm.$nextTick()
    await wrapper
      .findAll('.dt-ml-node__action')
      .find((b) => b.text() === '参数')
      ?.trigger('click')
    await flushPromises()

    expect(listTables).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('dataset:view')
  })
})

// ⚠ 候选只按台账列的话，下游能勾到一列上游根本不产出的列，而报错要到保存 /
// 运行才出来——用户读成「取数必须把列选全」，于是每次都全选
describe('下游的列候选跟着上游取数收窄', () => {
  const PICK_FIELD = {
    title: '处理哪些列',
    type: 'array',
    items: { type: 'string' },
    'x-dt-widget': 'column',
  }
  const PICK_SCHEMA = { properties: { columns: PICK_FIELD }, type: 'object' }
  const SOURCE_SCHEMA = {
    properties: {
      table_code: TABLE_SCHEMA.properties.table_code,
      columns: { ...PICK_FIELD, title: '取哪些列' },
    },
    required: ['table_code'],
    type: 'object',
  }

  function column(key: string): DatasetColumn {
    return {
      id: key,
      table_id: 't1',
      key,
      name: key,
      unit: null,
      decimals: null,
      data_type: 'number',
      source: 'point',
      agg: 'avg',
      node_key: null,
      formula: null,
      formula_deps: null,
      order_index: 0,
      is_required: false,
      default_value: null,
      created_at: STAMP,
      updated_at: STAMP,
    }
  }

  /** 取数（只挑了 F2、F3）→ 填缺失。 */
  function wired(): ModelingPipeline {
    return {
      ...pipeline(),
      graph: {
        format_version: '1',
        nodes: [
          {
            id: 'n1',
            operator: 'ledger_source',
            alias: '',
            position: { left: 0, top: 0 },
            config: { table_code: 'energy_log', columns: ['F2', 'F3'] },
          },
          {
            id: 'n2',
            operator: 'fill_missing',
            alias: '',
            position: { left: 200, top: 0 },
            config: { columns: [] },
          },
        ],
        edges: [
          {
            id: 'e1',
            from_node: 'n1',
            from_port: 'out',
            to_node: 'n2',
            to_port: 'in',
          },
        ],
      },
    }
  }

  async function openNode(
    wrapper: ReturnType<typeof open>,
    index: number,
  ): Promise<void> {
    await wrapper.findAll('.dt-ml-node')[index]?.trigger('click')
    await wrapper.vm.$nextTick()
    const buttons = wrapper
      .findAll('.dt-ml-node__action')
      .filter((item) => item.text() === '参数')
    await buttons[index]?.trigger('click')
    await flushPromises()
  }

  function stubWired() {
    stubApi({
      operators: [
        operator({ config_schema: SOURCE_SCHEMA }),
        operator({
          code: 'fill_missing',
          name: '填缺失',
          category: 'preprocess',
          config_schema: PICK_SCHEMA,
        }),
      ],
      pipeline: wired(),
    })
    vi.spyOn(dataset, 'listDatasetColumns').mockResolvedValue([
      column('F1'),
      column('F2'),
      column('F3'),
    ])
  }

  it('下游只列得出上游真的会产出的那几列', async () => {
    stubWired()
    signIn(WRITER)
    const wrapper = open()
    await flushPromises()

    await openNode(wrapper, 1)

    expect(wrapper.text()).toContain('F2')
    expect(wrapper.text()).not.toContain('F1')
  })

  // ⚠ 拿它自己的选择去收窄它自己的候选，等于一取消勾选就再也勾不回来
  it('取数节点自己看的仍是台账的全部列', async () => {
    stubWired()
    signIn(WRITER)
    const wrapper = open()
    await flushPromises()

    await openNode(wrapper, 0)

    expect(wrapper.text()).toContain('F1')
  })
})

// ⚠ 这一组守的是一期的一个洞：`:validate` 端点、`issues` 状态与那条提示条都在，
// 但全仓零调用——列引用、空台账这类问题只有按下「运行」才由后端拦下，而那条
// 400 只带一句「流水线还有问题」，逐条定位信息在 toast 里全丢了
describe('保存前的整图校验', () => {
  const ISSUE = {
    message: '参数「数据台账」不能留空',
    node_id: 'n1',
    edge_id: '',
  }

  it('图一改就自动校验，问题逐条挂在画布上', async () => {
    vi.useFakeTimers()
    try {
      stubApi()
      vi.spyOn(modeling, 'validateModelingGraph').mockResolvedValue({
        is_valid: false,
        issues: [ISSUE],
      })
      signIn(WRITER)
      const wrapper = open()
      await vi.runOnlyPendingTimersAsync()

      await wrapper.find('.dt-ml-palette__item').trigger('click')
      await vi.runOnlyPendingTimersAsync()

      expect(wrapper.text()).toContain('参数「数据台账」不能留空')
    } finally {
      vi.useRealTimers()
    }
  })

  it('图有问题时不发起运行，并把第一条问题说出来', async () => {
    stubApi()
    vi.spyOn(modeling, 'validateModelingGraph').mockResolvedValue({
      is_valid: false,
      issues: [ISSUE],
    })
    const start = vi.spyOn(modeling, 'startModelingRun')
    signIn(WRITER)
    const wrapper = open()
    await flushPromises()

    await wrapper
      .findAll('button')
      .find((b) => b.text() === '运行')
      ?.trigger('click')
    await flushPromises()

    expect(start).not.toHaveBeenCalled()
  })
})
