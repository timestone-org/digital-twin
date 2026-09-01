/**
 * @fileoverview 锁住建模接口的 URL 形状、方法、载荷，以及**每一条都带 platform
 * 前缀**、每个不可重放的写动作都带幂等键。
 *
 * ⚠ 漏给 `baseUrl` 不会有任何编译期报错：请求会打到 `/api/v1/auth/...`，边缘按
 * 前缀反代，拿回来的是一个 404 信封——现象是「这个页面没数据」，与真实原因隔得极远。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ModelingGraph } from '@dt/contracts'

import * as client from '@/api/client'
import * as modeling from '@/api/modeling'
import { PLATFORM_BASE_URL } from '@/config/app'

const EMPTY_GRAPH: ModelingGraph = { format_version: '1', nodes: [], edges: [] }

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
  ['getModelingRun', () => modeling.getModelingRun('r1')],
  ['getModelingNodeRun', () => modeling.getModelingNodeRun('r1', 'n1')],
  ['cancelModelingRun', () => modeling.cancelModelingRun('r1')],
  ['listModelingVersions', () => modeling.listModelingVersions()],
  [
    'publishModelingVersion',
    () => modeling.publishModelingVersion({ run_id: 'r1', name: 'v' }),
  ],
  ['getModelingVersion', () => modeling.getModelingVersion('v1')],
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
