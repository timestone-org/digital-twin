/**
 * @fileoverview 锁住历史读侧的 URL、窗口换算、游标翻页与「触顶如实说」。
 * ⚠ 空结果不许伪造：`points: []` 是真的没数据，翻页断了必须 reject 而不是截断返回。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as client from '@/api/client'
import {
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
  it('相对窗四种单位；不认识的写法回落一小时', () => {
    expect(windowToMs('30s')).toBe(30_000)
    expect(windowToMs('5m')).toBe(300_000)
    expect(windowToMs('2h')).toBe(7_200_000)
    expect(windowToMs('7d')).toBe(604_800_000)
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
