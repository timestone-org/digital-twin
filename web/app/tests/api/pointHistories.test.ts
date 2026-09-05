/**
 * @fileoverview 锁住历史读侧的 URL、窗口换算、游标翻页与「触顶如实说」。
 * ⚠ 空结果不许伪造：`points: []` 是真的没数据，翻页断了必须 reject 而不是截断返回。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DataSourceError } from '@dt/datasources'

import * as client from '@/api/client'
import {
  fetchPointAggregate,
  fetchPointHistory,
  resolveWindow,
  windowToMs,
} from '@/api/pointHistories'

const NOW = Date.parse('2026-08-14T12:00:00Z')

let requestMock: ReturnType<typeof vi.fn>

function page(
  items: { ts: string; value: unknown }[],
  next: string | null,
  hasMore: boolean,
): Record<string, unknown> {
  return {
    items: items.map((item) => ({
      node_key: 's1:temp',
      ts: item.ts,
      value: item.value,
      quality: 'good',
    })),
    next,
    has_more: hasMore,
  }
}

beforeEach(() => {
  requestMock = vi.fn()
  vi.spyOn(client, 'requestData').mockImplementation(requestMock)
})

afterEach(() => {
  vi.restoreAllMocks()
})

function lastCall(): [string, Record<string, unknown>] {
  const args = requestMock.mock.calls.at(-1)
  return [args?.[0] as string, (args?.[1] ?? {}) as Record<string, unknown>]
}

describe('窗口换算', () => {
  it('相对窗四种单位；给界面那一面的换算认不出就回落一小时', () => {
    expect(windowToMs('30s')).toBe(30_000)
    expect(windowToMs('5m')).toBe(300_000)
    expect(windowToMs('2h')).toBe(7_200_000)
    expect(windowToMs('7d')).toBe(604_800_000)
    // ⚠ 桶宽档位表要在半截输入下也给得出一份清单，故这一面认不出不许抛
    expect(windowToMs('怪写法')).toBe(3_600_000)
    expect(windowToMs(undefined)).toBe(3_600_000)
  })

  it('fromMs 优先于 lastWindow；只给 limit 时兜底一小时', () => {
    expect(
      resolveWindow({ fromMs: 1000, toMs: 5000, lastWindow: '1d' }, NOW),
    ).toEqual({ fromMs: 1000, toMs: 5000 })
    expect(resolveWindow({ limit: 10 }, NOW)).toEqual({
      fromMs: NOW - 3_600_000,
      toMs: NOW,
    })
    expect(resolveWindow({ lastWindow: '' }, NOW)).toEqual({
      fromMs: NOW - 3_600_000,
      toMs: NOW,
    })
  })

  it('⚠ 取数一侧认不出的相对窗落 invalid-query，不是静默回落一小时', () => {
    for (const written of ['1w', '30min', '1H']) {
      expect(() => resolveWindow({ lastWindow: written }, NOW)).toThrow(
        DataSourceError,
      )
    }
    expect(() => resolveWindow({ lastWindow: '1w' }, NOW)).toThrow(/1w/)
  })

  it('写错的相对窗在 fromMs 给了的时候不碍事', () => {
    expect(
      resolveWindow({ fromMs: 1000, toMs: 5000, lastWindow: '1w' }, NOW),
    ).toEqual({ fromMs: 1000, toMs: 5000 })
  })
})

describe('取数', () => {
  it('打在 platform 前缀上，窗口下发成 RFC3339', async () => {
    requestMock.mockResolvedValue(page([], null, false))

    await fetchPointHistory(
      { nodeKey: 's1:temp', range: { lastWindow: '1h' } },
      NOW,
    )

    const [path, options] = lastCall()
    expect(path).toBe('/point-histories')
    expect(options.baseUrl).toBe('/api/v1/platform')
    expect(options.query).toMatchObject({
      node_keys: 's1:temp',
      range_start: '2026-08-14T11:00:00.000Z',
      range_end: '2026-08-14T12:00:00.000Z',
    })
  })

  it('跟着游标翻页取齐，按时刻升序映射成 {t, v}', async () => {
    requestMock
      .mockResolvedValueOnce(
        page([{ ts: '2026-08-14T11:10:00Z', value: 1 }], 'c1', true),
      )
      .mockResolvedValueOnce(
        page([{ ts: '2026-08-14T11:20:00Z', value: 2 }], null, false),
      )

    const result = await fetchPointHistory(
      { nodeKey: 's1:temp', range: { lastWindow: '1h' } },
      NOW,
    )

    expect(requestMock).toHaveBeenCalledTimes(2)
    const second = requestMock.mock.calls.at(-1)?.[1] as {
      query: Record<string, unknown>
    }
    expect(second.query.after).toBe('c1')
    expect(result.points).toEqual([
      { t: Date.parse('2026-08-14T11:10:00Z'), v: 1 },
      { t: Date.parse('2026-08-14T11:20:00Z'), v: 2 },
    ])
    expect(result.isTruncated).toBe(false)
    expect(result.isStale).toBe(false)
  })

  it('点数触顶时停止翻页并如实标 isTruncated', async () => {
    requestMock.mockResolvedValue(
      page(
        [
          { ts: '2026-08-14T11:10:00Z', value: 1 },
          { ts: '2026-08-14T11:11:00Z', value: 2 },
        ],
        'c-next',
        true,
      ),
    )

    const result = await fetchPointHistory(
      { nodeKey: 's1:temp', range: { lastWindow: '1h', limit: 2 } },
      NOW,
    )

    expect(requestMock).toHaveBeenCalledTimes(1)
    expect(result.points).toHaveLength(2)
    expect(result.isTruncated).toBe(true)
  })

  it('相对窗写错时当场拒绝，不拿一小时的曲线冒充七天', async () => {
    await expect(
      fetchPointHistory(
        { nodeKey: 's1:temp', range: { lastWindow: '1w' } },
        NOW,
      ),
    ).rejects.toMatchObject({ code: 'invalid-query' })
    expect(requestMock).not.toHaveBeenCalled()
  })

  it('翻页中途失败整体 reject，不拿半截结果冒充取齐', async () => {
    requestMock
      .mockResolvedValueOnce(
        page([{ ts: '2026-08-14T11:10:00Z', value: 1 }], 'c1', true),
      )
      .mockRejectedValueOnce(new Error('boom'))

    await expect(
      fetchPointHistory(
        { nodeKey: 's1:temp', range: { lastWindow: '1h' } },
        NOW,
      ),
    ).rejects.toThrow('boom')
  })
})

describe('分桶聚合', () => {
  it('⚠ 一次请求带全部点位：拆成一个点位一次就是 N 条各自会失败的链路', async () => {
    requestMock.mockResolvedValue({
      items: [],
      interval: '5m',
      aggregate: 'avg',
      timezone: 'Asia/Shanghai',
      is_truncated: false,
    })

    await fetchPointAggregate({
      nodeKeys: ['s1:temp', 's1:flow'],
      fromMs: Date.parse('2026-08-14T11:00:00Z'),
      toMs: NOW,
      interval: '5m',
      aggregate: 'max',
    })

    const [path, options] = lastCall()
    expect(path).toBe('/point-histories:aggregate')
    expect(options.method).toBe('POST')
    // ⚠ 键名逐字锁住：写歪一个后端就是 422，而前端这边看不出哪里错了
    expect(options.body).toEqual({
      node_keys: ['s1:temp', 's1:flow'],
      range_start: '2026-08-14T11:00:00.000Z',
      range_end: '2026-08-14T12:00:00.000Z',
      interval: '5m',
      aggregate: 'max',
    })
  })

  it('取消信号原样递进去，不给它就不带这个键', async () => {
    requestMock.mockResolvedValue({
      items: [],
      interval: '5m',
      aggregate: 'avg',
      timezone: 'UTC',
      is_truncated: false,
    })
    const controller = new AbortController()
    const query = {
      nodeKeys: ['s1:temp'],
      fromMs: Date.parse('2026-08-14T11:00:00Z'),
      toMs: NOW,
      interval: '5m',
      aggregate: 'avg',
    }

    await fetchPointAggregate(query, controller.signal)
    expect(lastCall()[1].signal).toBe(controller.signal)

    await fetchPointAggregate(query)
    expect(lastCall()[1]).not.toHaveProperty('signal')
  })

  it('触顶如实带上来，不悄悄当成「就这么多」', async () => {
    requestMock.mockResolvedValue({
      items: [],
      interval: '1s',
      aggregate: 'avg',
      timezone: 'UTC',
      is_truncated: true,
    })
    const result = await fetchPointAggregate({
      nodeKeys: ['s1:temp'],
      fromMs: Date.parse('2026-08-14T11:00:00Z'),
      toMs: NOW,
      interval: '1s',
      aggregate: 'avg',
    })
    expect(result.is_truncated).toBe(true)
  })
})
