/**
 * @fileoverview 锁住建模接口的 URL 形状、方法、载荷，以及**每一条都带 platform
 * 前缀**、每个不可重放的写动作都带幂等键。
 *
 * ⚠ 漏给 `baseUrl` 不会有任何编译期报错：请求会打到 `/api/v1/auth/...`，边缘按
 * 前缀反代，拿回来的是一个 404 信封——现象是「这个页面没数据」，与真实原因隔得极远。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ModelingBinding, ModelingGraph } from '@dt/contracts'

import * as client from '@/api/client'
import * as modeling from '@/api/modeling'
import { PLATFORM_BASE_URL } from '@/config/app'

const EMPTY_GRAPH: ModelingGraph = { format_version: '1', nodes: [], edges: [] }
const STAMP = '2026-01-01T00:00:00.000Z'

let requestMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  // ⚠ 两个入口都要桩：取数走 requestData，204 的删除走 request
  requestMock = vi
    .fn()
    .mockResolvedValue({ items: [], page: 1, size: 200, total: 0 })
  vi.spyOn(client, 'request').mockImplementation(requestMock)
  vi.spyOn(client, 'requestData').mockImplementation(requestMock)
})

afterEach(() => {
  vi.restoreAllMocks()
})

function call(): [string, Record<string, unknown>] {
  const args = requestMock.mock.calls.at(-1)
  return [args?.[0] as string, (args?.[1] ?? {}) as Record<string, unknown>]
}

function headersOf(options: Record<string, unknown>): Record<string, string> {
  return (options['headers'] ?? {}) as Record<string, string>
}

it('部署详情补取修订号时透传取消信号', async () => {
  const controller = new AbortController()
  await modeling.getModelDeployment('deployment-1', controller.signal)
  expect(call()).toEqual([
    '/modeling-deployments/deployment-1',
    { baseUrl: PLATFORM_BASE_URL, signal: controller.signal },
  ])
  await modeling.getModelDeployment('deployment-1')
  expect(call()[1]['signal']).toBeUndefined()
})

it('部署启停保留各自expected_revision作为并发保护', async () => {
  await modeling.updateModelDeployment('deployment-1', {
    is_enabled: false,
    expected_revision: 7,
  })
  expect(call()).toEqual([
    '/modeling-deployments/deployment-1',
    {
      baseUrl: PLATFORM_BASE_URL,
      method: 'PATCH',
      body: { is_enabled: false, expected_revision: 7 },
    },
  ])
})

it('BDM 目录走平台代理并传递取消信号', async () => {
  const controller = new AbortController()
  await modeling.listModelingBdmCatalog(
    { kind: 'point', page: 2, keyword: '温度' },
    controller.signal,
  )
  expect(call()).toEqual([
    '/modeling-bdm-catalogs',
    {
      baseUrl: PLATFORM_BASE_URL,
      query: { kind: 'point', page: 2, size: 50, keyword: '温度' },
      signal: controller.signal,
    },
  ])
})

it('BDM 单页目录支持指定每页条数', async () => {
  await modeling.listModelingBdmCatalog({ kind: 'formula', page: 2, size: 200 })
  expect(call()[1]['query']).toEqual({ kind: 'formula', page: 2, size: 200 })
})

it('能管配置能力经平台读取并传递取消信号', async () => {
  await modeling.getModelingBdmCapabilities()
  expect(call()).toEqual([
    '/modeling-bdm-capabilities',
    { baseUrl: PLATFORM_BASE_URL },
  ])
  const controller = new AbortController()
  await modeling.getModelingBdmCapabilities(controller.signal)
  expect(call()[1]['signal']).toBe(controller.signal)
})

it('指标绑定仅向平台代理传递编码和分页，保留取消信号', async () => {
  const controller = new AbortController()
  const query = { code: 'energy.intensity', page: 2, size: 50 }
  await modeling.listModelingBdmIndicators(query, controller.signal)
  expect(call()).toEqual([
    '/modeling-bdm-indicators',
    { baseUrl: PLATFORM_BASE_URL, query, signal: controller.signal },
  ])
  await modeling.listModelingBdmIndicators({ code: '', page: 1 })
  expect(call()[1]['signal']).toBeUndefined()
})

it('点位完整编码与不可查询开关按接口字段传递', async () => {
  await modeling.listModelingBdmCatalog({
    kind: 'point',
    page: 1,
    code: 'P1',
    include_unqueryable: true,
  })
  expect(call()[1]['query']).toEqual({
    kind: 'point',
    page: 1,
    size: 50,
    code: 'P1',
    include_unqueryable: true,
  })
})

it.each(['point', 'raw', 'formula'] as const)(
  '%s 目录按名称向平台代理传递过滤',
  async (kind) => {
    await modeling.listModelingBdmCatalog({ kind, page: 1, name: '能耗' })
    expect(call()[1]['query']).toEqual({
      kind,
      page: 1,
      size: 50,
      name: '能耗',
    })
  },
)

it('属性名称和系统条件同时传递', async () => {
  await modeling.listModelingBdmCatalog({
    kind: 'raw',
    page: 1,
    name: '功率',
    system: '空压系统',
  })
  expect(call()[1]['query']).toEqual({
    kind: 'raw',
    page: 1,
    size: 50,
    name: '功率',
    system: '空压系统',
  })
})

it('系统目录经平台鉴权并支持取消', async () => {
  const controller = new AbortController()
  await modeling.listModelingBdmSystems(controller.signal)
  expect(call()).toEqual([
    '/modeling-bdm-systems',
    { baseUrl: PLATFORM_BASE_URL, signal: controller.signal },
  ])
  await modeling.listModelingBdmSystems()
  expect(call()).toEqual([
    '/modeling-bdm-systems',
    { baseUrl: PLATFORM_BASE_URL },
  ])
})

const CALLS: [string, () => Promise<unknown>][] = [
  ['listModelingOperators', () => modeling.listModelingOperators()],
  ['listModelingPipelines', () => modeling.listModelingPipelines()],
  ['getModelingPipeline', () => modeling.getModelingPipeline('p1')],
  [
    'createModelingPipeline',
    () => modeling.createModelingPipeline({ code: 'c', name: 'n' }),
  ],
  [
    'updateModelingPipeline',
    () => modeling.updateModelingPipeline('p1', { name: 'n' }),
  ],
  ['deleteModelingPipeline', () => modeling.deleteModelingPipeline('p1')],
  [
    'validateModelingGraph',
    () => modeling.validateModelingGraph('p1', EMPTY_GRAPH),
  ],
  ['startModelingRun', () => modeling.startModelingRun('p1')],
  ['listModelingRuns', () => modeling.listModelingRuns('p1')],
  ['listModelingRunHistory', () => modeling.listModelingRunHistory(null)],
  ['listModelDeploymentsPage', () => modeling.listModelDeploymentsPage()],
  ['getModelingRun', () => modeling.getModelingRun('r1')],
  ['getModelingNodeRun', () => modeling.getModelingNodeRun('r1', 'n1')],
  ['cancelModelingRun', () => modeling.cancelModelingRun('r1')],
  ['listModelingVersions', () => modeling.listModelingVersions()],
  [
    'publishModelingVersion',
    () => modeling.publishModelingVersion({ run_id: 'r1', name: 'v' }),
  ],
  ['getModelingVersion', () => modeling.getModelingVersion('v1')],
  [
    'updateModelingVersion',
    () => modeling.updateModelingVersion('v1', { name: '设备能效评估模型' }),
  ],
  ['retireModelingVersion', () => modeling.retireModelingVersion('v1')],
  ['listModelingBindings', () => modeling.listModelingBindings()],
  [
    'createModelingBinding',
    () =>
      modeling.createModelingBinding({
        fx_code: 'fx',
        model_version_id: 'v1',
      }),
  ],
  [
    'updateModelingBinding',
    () => modeling.updateModelingBinding('b1', { is_enabled: false }),
  ],
  ['deleteModelingBinding', () => modeling.deleteModelingBinding('b1')],
]

describe('每一条都打 platform 前缀', () => {
  it.each(CALLS)('%s', async (_name, run) => {
    await run()

    const [path, options] = call()
    expect(options['baseUrl']).toBe(PLATFORM_BASE_URL)
    expect(path.startsWith('/modeling-')).toBe(true)
  })

  // ⚠ 前缀由 `baseUrl` 给，路径里**不能再写一遍**：客户端是 `${baseUrl}${path}`
  // 直接拼，写全了会拼成 /api/v1/platform/api/v1/platform/… 一律 404，而
  // typecheck、lint 与打了桩的单测全都拦不住
  it.each(CALLS)('%s 的路径不重复带前缀', async (_name, run) => {
    await run()

    expect(call()[0].startsWith(PLATFORM_BASE_URL)).toBe(false)
  })
})

describe('URL 与方法', () => {
  it('绑定直接请求后端分页，空结果仍保留真实总数和页码', async () => {
    const response = { items: [], page: 4, size: 20, total: 60 }
    requestMock.mockResolvedValueOnce(response)
    expect(await modeling.listModelingBindings({ page: 4, size: 20 })).toEqual(
      response,
    )
    expect(call()[1]['query']).toEqual({ page: 4, size: 20 })
  })

  it('绑定分页与检索由后端完成，不再次slice服务端返回的当前页', async () => {
    const rows: ModelingBinding[] = ['b1', 'b2', 'b3'].map((id) => ({
      id,
      fx_code: id,
      model_version_id: 'v1',
      param_map: [],
      is_enabled: true,
      is_orphaned: false,
      created_by_name: null,
      created_at: STAMP,
      updated_at: STAMP,
    }))
    const response = {
      items: [rows[2]],
      page: 2,
      size: 2,
      total: 3,
    }
    requestMock.mockResolvedValueOnce(response)
    const controller = new AbortController()
    expect(
      await modeling.listModelingBindings(
        { page: 2, size: 2, q: ' 冷机 ' },
        controller.signal,
      ),
    ).toEqual(response)
    expect(call()[1]['query']).toEqual({ page: 2, size: 2, q: '冷机' })
    expect(call()[1]['signal']).toBe(controller.signal)
  })

  it('旧服务端返回数组不能被当成已分页结果或再次前端切分', async () => {
    requestMock.mockResolvedValueOnce([])
    await expect(modeling.listModelingBindings()).rejects.toBeInstanceOf(
      client.TransportError,
    )
  })

  it('部署管理按后端页读取，保留false精确筛选及取消信号', async () => {
    const controller = new AbortController()
    const response = { items: [], page: 2, size: 10, total: 15 }
    requestMock.mockResolvedValueOnce(response)
    expect(
      await modeling.listModelDeploymentsPage(
        { page: 2, size: 10, q: ' 风机 ', isEnabled: false },
        controller.signal,
      ),
    ).toEqual(response)
    expect(call()).toEqual([
      '/modeling-deployments',
      {
        baseUrl: PLATFORM_BASE_URL,
        signal: controller.signal,
        query: { page: 2, size: 10, q: '风机', is_enabled: false },
      },
    ])
  })

  it('工作流检索透传后端q和signal，不发送空白检索', async () => {
    const controller = new AbortController()
    await modeling.listModelingPipelines(
      { page: 2, size: 20, q: '  Energy_1%  ', includeInstances: false },
      controller.signal,
    )
    expect(call()[1]).toMatchObject({
      signal: controller.signal,
      query: { page: 2, size: 20, q: 'Energy_1%', include_instances: false },
    })
    await modeling.listModelingPipelines({ q: '  ' })
    expect(call()[1]['query']).not.toHaveProperty('q')
  })

  it('训练历史使用不透明游标，查询和状态交给后端', async () => {
    const controller = new AbortController()
    requestMock.mockResolvedValueOnce({
      items: [],
      next: null,
      has_more: false,
    })
    await modeling.listModelingRunHistory(
      'pipeline-7',
      { after: 'opaque-cursor', limit: 50, q: ' 冷机 ', status: 'failed' },
      controller.signal,
    )
    expect(call()).toEqual([
      '/modeling-runs',
      {
        baseUrl: PLATFORM_BASE_URL,
        signal: controller.signal,
        query: {
          pagination: 'cursor',
          pipeline_id: 'pipeline-7',
          after: 'opaque-cursor',
          limit: 50,
          q: '冷机',
          status: 'failed',
        },
      },
    ])
  })

  it('算子目录是一条读', async () => {
    await modeling.listModelingOperators()

    const [path, options] = call()
    expect(path).toBe('/modeling-operators')
    expect(options['method']).toBeUndefined()
  })

  it('校验与发起运行都是动作端点，冒号在路径末尾', async () => {
    await modeling.validateModelingGraph('p1', EMPTY_GRAPH)
    expect(call()[0]).toBe('/modeling-pipelines/p1:validate')

    await modeling.startModelingRun('p1')
    expect(call()[0]).toBe('/modeling-pipelines/p1:run')
  })

  it('取消运行打在运行自己身上，不是打在流水线上', async () => {
    await modeling.cancelModelingRun('r1')

    expect(call()[0]).toBe('/modeling-runs/r1:cancel')
  })

  it('节点结果是运行下面的一条子路径', async () => {
    await modeling.getModelingNodeRun('r1', 'n1')

    expect(call()[0]).toBe('/modeling-runs/r1/nodes/n1')
  })

  it('运行列表按流水线过滤，翻页参数原样带上', async () => {
    await modeling.listModelingRuns('p1', { page: 2, size: 20 })

    const [path, options] = call()
    expect(path).toBe('/modeling-runs')
    expect(options['query']).toEqual({
      pipeline_id: 'p1',
      page: 2,
      size: 20,
    })
  })

  it('版本列表按流水线过滤时用 pipeline_id 这个线上名字', async () => {
    await modeling.listModelingVersions({ pipelineId: 'p1' })

    expect(call()[1]['query']).toEqual({
      pipeline_id: 'p1',
      page: undefined,
      size: undefined,
    })
  })

  it('改流水线是 PATCH，缺省字段不动', async () => {
    await modeling.updateModelingPipeline('p1', { name: '新名' })

    const [path, options] = call()
    expect(path).toBe('/modeling-pipelines/p1')
    expect(options['method']).toBe('PATCH')
    expect(options['body']).toEqual({ name: '新名' })
  })

  it('取运行详情可以带取消信号——换一条运行看时要能把上一轮掐掉', async () => {
    const controller = new AbortController()

    await modeling.getModelingRun('r1', controller.signal)

    expect(call()[1]['signal']).toBe(controller.signal)
  })

  it('不给信号时不往选项里塞一个 undefined', async () => {
    await modeling.getModelingRun('r1')

    expect('signal' in call()[1]).toBe(false)
  })
})

describe('幂等键', () => {
  it.each([
    [
      'createModelingPipeline',
      () => modeling.createModelingPipeline({ code: 'c', name: 'n' }),
    ],
    ['deleteModelingPipeline', () => modeling.deleteModelingPipeline('p1')],
    ['startModelingRun', () => modeling.startModelingRun('p1')],
    ['cancelModelingRun', () => modeling.cancelModelingRun('r1')],
    [
      'publishModelingVersion',
      () => modeling.publishModelingVersion({ run_id: 'r1', name: 'v' }),
    ],
    ['retireModelingVersion', () => modeling.retireModelingVersion('v1')],
    [
      'createModelingBinding',
      () =>
        modeling.createModelingBinding({
          fx_code: 'fx',
          model_version_id: 'v1',
        }),
    ],
    ['deleteModelingBinding', () => modeling.deleteModelingBinding('b1')],
  ])('%s 带幂等键', async (_name, run) => {
    await run()

    expect(headersOf(call()[1])['Idempotency-Key']).toBeTruthy()
  })

  it('两次调用的键不一样，不然第二次会被当成重放丢掉', async () => {
    await modeling.startModelingRun('p1')
    const first = headersOf(call()[1])['Idempotency-Key']
    await modeling.startModelingRun('p1')

    expect(headersOf(call()[1])['Idempotency-Key']).not.toBe(first)
  })

  it.each([
    [
      'updateModelingPipeline',
      () => modeling.updateModelingPipeline('p1', { name: 'n' }),
    ],
    [
      'updateModelingBinding',
      () => modeling.updateModelingBinding('b1', { is_enabled: true }),
    ],
    [
      'validateModelingGraph',
      () => modeling.validateModelingGraph('p1', EMPTY_GRAPH),
    ],
  ])(
    '%s 不带幂等键——PATCH 本身幂等，带上反而把连点两次当成两次写',
    async (_name, run) => {
      await run()

      expect(headersOf(call()[1])['Idempotency-Key']).toBeUndefined()
    },
  )
})

describe('204 的那两条走 request 而不是 requestData', () => {
  it.each([
    ['deleteModelingPipeline', () => modeling.deleteModelingPipeline('p1')],
    ['deleteModelingBinding', () => modeling.deleteModelingBinding('b1')],
  ])('%s', async (_name, run) => {
    const data = vi.spyOn(client, 'requestData')

    await run()

    expect(data).not.toHaveBeenCalled()
  })
})

describe('读取取消信号', () => {
  const reads: [string, (signal: AbortSignal) => Promise<unknown>][] = [
    ['算子目录', (signal) => modeling.listModelingOperators(signal)],
    ['流水线', (signal) => modeling.getModelingPipeline('p1', signal)],
    ['运行历史', (signal) => modeling.listModelingRuns('p1', {}, signal)],
    ['节点预览', (signal) => modeling.getModelingNodeRun('r1', 'n1', signal)],
  ]
  it.each(reads)('%s传递相同信号到统一请求层', async (_name, read) => {
    const controller = new AbortController()
    await read(controller.signal)
    expect(call()[1]['signal']).toBe(controller.signal)
    expect(call()[1]['baseUrl']).toBe(PLATFORM_BASE_URL)
  })
})
