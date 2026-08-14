/**
 * @fileoverview 锁住采集点位只读面的 URL、前缀与出参映射。
 * ⚠ 前缀写错会静默打到 auth-server 上，现象是「挑点面板永远搜不到东西」。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as client from '@/api/client'
import * as collect from '@/api/collect'

const PLATFORM_PREFIX = '/api/v1/platform'

let requestMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  requestMock = vi.fn().mockResolvedValue({
    items: [
      {
        id: 'pt1',
        source_id: 's1',
        node_key: 's1:temp',
        code: 'temp',
        name: '出口温度',
        data_type: 'float',
        unit: '℃',
      },
    ],
    page: 1,
    size: 50,
    total: 1,
  })
  vi.spyOn(client, 'requestData').mockImplementation(requestMock)
})

afterEach(() => {
  vi.restoreAllMocks()
})

function call(): [string, Record<string, unknown>] {
  const args = requestMock.mock.calls.at(-1)
  return [args?.[0] as string, (args?.[1] ?? {}) as Record<string, unknown>]
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

  it('出参转成 camelCase，`nodeKey` 是点位在全系统里的身份', async () => {
    const page = await collect.listPoints()

    expect(page.items[0]).toEqual({
      id: 'pt1',
      sourceId: 's1',
      nodeKey: 's1:temp',
      code: 'temp',
      name: '出口温度',
      dataType: 'float',
      unit: '℃',
    })
  })
})

describe('数据源', () => {
  it('打在 collect-sources 上并转成 camelCase', async () => {
    requestMock.mockResolvedValue({
      items: [{ id: 's1', name: '一号采集', protocol: 'opcua' }],
      page: 1,
      size: 20,
      total: 1,
    })

    const page = await collect.listSources({ q: '一号' })

    expect(call()[0]).toBe('/collect-sources')
    expect(page.items[0]).toEqual({
      id: 's1',
      name: '一号采集',
      protocol: 'opcua',
    })
  })
})
