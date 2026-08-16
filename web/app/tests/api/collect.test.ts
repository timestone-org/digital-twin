/**
 * @fileoverview 锁住数据采集配置面的 URL、前缀、方法与幂等键。
 * ⚠ 前缀写错会静默打到 auth-server 上，现象是「页面永远搜不到东西」而不是报错。
 * ⚠ 三处写口必须带 `Idempotency-Key`：漏了它，一次网络抖动引发的重试会建两个
 * 数据源、建两批点位，或者向 PLC 下发两次。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as client from '@/api/client'
import * as collect from '@/api/collect'

const PLATFORM_PREFIX = '/api/v1/platform'

let requestMock: ReturnType<typeof vi.fn>
let rawRequestMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  requestMock = vi.fn().mockResolvedValue({
    items: [],
    page: 1,
    size: 20,
    total: 0,
  })
  rawRequestMock = vi.fn().mockResolvedValue(undefined)
  vi.spyOn(client, 'requestData').mockImplementation(requestMock)
  vi.spyOn(client, 'request').mockImplementation(rawRequestMock)
})

afterEach(() => {
  vi.restoreAllMocks()
})

function call(): [string, Record<string, unknown>] {
  const args = requestMock.mock.calls.at(-1)
  return [args?.[0] as string, (args?.[1] ?? {}) as Record<string, unknown>]
}

function rawCall(): [string, Record<string, unknown>] {
  const args = rawRequestMock.mock.calls.at(-1)
  return [args?.[0] as string, (args?.[1] ?? {}) as Record<string, unknown>]
}

function headerOf(options: Record<string, unknown>): string | undefined {
  const headers = options.headers as Record<string, string> | undefined
  return headers?.['Idempotency-Key']
}

describe('点位', () => {
  it('打在 platform 前缀的 collect-points 上', async () => {
    await collect.listPoints()
    const [path, options] = call()

    expect(path).toBe('/collect-points')
    expect(options.baseUrl).toBe(PLATFORM_PREFIX)
  })

  it('数据源与关键字下发成 snake_case 的查询参数', async () => {
    await collect.listPoints({ sourceId: 's1', q: '温度', page: 2, size: 10 })

    expect(call()[1].query).toEqual({
      source_id: 's1',
      q: '温度',
      page: 2,
      size: 10,
    })
  })

  it('带取消信号时透传下去，连着敲关键字才掐得掉在途请求', async () => {
    const controller = new AbortController()
    await collect.listPoints({}, controller.signal)

    expect(call()[1].signal).toBe(controller.signal)
  })

  it('不给取消信号时不塞一个 undefined 进去', async () => {
    await collect.listPoints()

    expect('signal' in call()[1]).toBe(false)
  })

  it('批量建点带幂等键，重试才不会建出两批', async () => {
    await collect.createPoints({ source_id: 's1', items: [] }, 'key-1')
    const [path, options] = call()

    expect([path, options.method]).toEqual(['/collect-points', 'POST'])
    expect(headerOf(options)).toBe('key-1')
  })

  it('不给幂等键时自己生成一个，绝不空着发出去', async () => {
    await collect.createPoints({ source_id: 's1', items: [] })

    expect(headerOf(call()[1])).toBeTruthy()
  })

  it('改点位走 PATCH，缺省的字段不动', async () => {
    await collect.updatePoint('p1', { name: '新名字' })
    const [path, options] = call()

    expect([path, options.method]).toEqual(['/collect-points/p1', 'PATCH'])
    expect(options.body).toEqual({ name: '新名字' })
  })

  it('删点位走 DELETE 且不解信封', async () => {
    await collect.deletePoint('p1')
    const [path, options] = rawCall()

    expect([path, options.method, options.baseUrl]).toEqual([
      '/collect-points/p1',
      'DELETE',
      PLATFORM_PREFIX,
    ])
  })

  it('下发写值打动作端点并带幂等键', async () => {
    await collect.writePoint('p1', 42, 'key-w')
    const [path, options] = call()

    expect([path, options.method]).toEqual(['/collect-points/p1:write', 'POST'])
    expect(options.body).toEqual({ value: 42 })
    expect(headerOf(options)).toBe('key-w')
  })

  it('写值 0 与 false 照样发出去，不被当成「没填」', async () => {
    await collect.writePoint('p1', false)

    expect(call()[1].body).toEqual({ value: false })
  })
})

describe('数据源', () => {
  it('打在 collect-sources 上', async () => {
    await collect.listSources({ q: '一号' })

    expect(call()[0]).toBe('/collect-sources')
  })

  it('协议与启用态下发成 snake_case', async () => {
    await collect.listSources({ protocol: 'opcua', isEnabled: false })

    expect(call()[1].query).toMatchObject({
      protocol: 'opcua',
      is_enabled: false,
    })
  })

  it('建数据源带幂等键', async () => {
    await collect.createSource(
      {
        name: '一号采集',
        code: 'plant1',
        protocol: 'opcua',
        endpoint: 'opc.tcp://10.0.0.2:4840',
      },
      'key-s',
    )

    expect(headerOf(call()[1])).toBe('key-s')
  })

  it('改数据源走 PATCH', async () => {
    await collect.updateSource('s1', { is_enabled: false })
    const [path, options] = call()

    expect([path, options.method]).toEqual(['/collect-sources/s1', 'PATCH'])
  })

  it('连通性测试打动作端点', async () => {
    await collect.testSource('s1')
    const [path, options] = call()

    expect([path, options.method]).toEqual(['/collect-sources/s1:test', 'POST'])
  })

  it('浏览地址空间把 parent 放在请求体里', async () => {
    await collect.browseSource('s1', 'ns=2;s=Plant')
    const [path, options] = call()

    expect(path).toBe('/collect-sources/s1:browse')
    expect(options.body).toEqual({ parent: 'ns=2;s=Plant' })
  })

  it('从根开始浏览时 parent 显式给 null', async () => {
    // 不给字段的话后端按缺省处理，两种意图在线上分不开
    await collect.browseSource('s1', null)

    expect(call()[1].body).toEqual({ parent: null })
  })

  it('浏览带取消信号，连着展开节点才掐得掉在途请求', async () => {
    const controller = new AbortController()
    await collect.browseSource('s1', null, controller.signal)

    expect(call()[1].signal).toBe(controller.signal)
  })

  it('删数据源走 DELETE', async () => {
    await collect.deleteSource('s1')

    expect(rawCall()[1].method).toBe('DELETE')
  })
})
