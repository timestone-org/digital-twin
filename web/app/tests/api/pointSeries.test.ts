/**
 * @fileoverview 锁住点位序列批量取数的合并口径：同窗同档并成一次请求、长窗按
 * 明确桶宽切段后拼接、触顶方向原样透传，以及认不出的相对窗落 invalid-query。
 * ⚠ 「窗内 0 点」是 ok 加空序列，「取不到」才是 error——两者不许长成一个样。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CollectHistoryAggregate } from '@dt/contracts'

import * as histories from '@/api/pointHistories'
import { readPointSeries } from '@/api/pointSeries'
import type { PointSeriesRequest } from '@/api/pointSeries'

const NOW = Date.parse('2026-08-14T12:00:00Z')
const DAY = 86_400_000

let aggregateMock: ReturnType<typeof vi.fn>

function aggregate(
  items: { node_key: string; at: number; value: number | null }[] = [],
  isTruncated = false,
): CollectHistoryAggregate {
  return {
    items: items.map((one) => ({
      node_key: one.node_key,
      bucket_start: new Date(one.at).toISOString(),
      value: one.value,
      sample_count: 1,
    })),
    interval: '30s',
    aggregate: 'avg',
    timezone: 'UTC',
    is_truncated: isTruncated,
  }
}

function request(
  fieldKey: string,
  nodeKey: string,
  detail: Partial<PointSeriesRequest['detail']> = {},
): PointSeriesRequest {
  return {
    fieldKey,
    detail: { nodeKey, range: { lastWindow: '1h' }, ...detail },
  }
}

function callAt(index: number): Record<string, unknown> {
  const args = aggregateMock.mock.calls[index]
  return (args?.[0] ?? {}) as Record<string, unknown>
}

beforeEach(() => {
  aggregateMock = vi.fn().mockResolvedValue(aggregate())
  vi.spyOn(histories, 'fetchPointAggregate').mockImplementation(aggregateMock)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('批量合并', () => {
  it('同窗同档的 8 个点位并成一次请求', async () => {
    const wanted = Array.from({ length: 8 }, (_, index) =>
      request(`s${index}`, `src:p${index}`),
    )

    const found = await readPointSeries(wanted, undefined, NOW)

    expect(aggregateMock).toHaveBeenCalledTimes(1)
    expect(callAt(0).nodeKeys).toEqual([
      'src:p0',
      'src:p1',
      'src:p2',
      'src:p3',
      'src:p4',
      'src:p5',
      'src:p6',
      'src:p7',
    ])
    expect(found.size).toBe(8)
  })

  it('同一个点位被两个槽绑着只问一次，两个槽拿到同一条序列', async () => {
    aggregateMock.mockResolvedValue(
      aggregate([
        {
          node_key: 'src:p1',
          at: Date.parse('2026-08-14T11:30:00Z'),
          value: 7,
        },
      ]),
    )

    const found = await readPointSeries(
      [request('a', 'src:p1'), request('b', 'src:p1')],
      undefined,
      NOW,
    )

    expect(callAt(0).nodeKeys).toEqual(['src:p1'])
    const point = { t: Date.parse('2026-08-14T11:30:00Z'), v: 7 }
    expect(found.get('a')).toMatchObject({ state: 'ok', points: [point] })
    expect(found.get('b')).toMatchObject({ state: 'ok', points: [point] })
  })

  it('窗口不同的两条各问各的', async () => {
    await readPointSeries(
      [
        request('a', 'src:p1'),
        request('b', 'src:p2', { range: { lastWindow: '2h' } }),
      ],
      undefined,
      NOW,
    )

    expect(aggregateMock).toHaveBeenCalledTimes(2)
    expect(callAt(0).fromMs).toBe(NOW - 3_600_000)
    expect(callAt(1).fromMs).toBe(NOW - 7_200_000)
  })

  it('超过 50 个点位切成两次请求', async () => {
    const wanted = Array.from({ length: 60 }, (_, index) =>
      request(`s${index}`, `src:p${index}`),
    )

    await readPointSeries(wanted, undefined, NOW)

    expect(aggregateMock).toHaveBeenCalledTimes(2)
    expect((callAt(0).nodeKeys as string[]).length).toBe(50)
    expect((callAt(1).nodeKeys as string[]).length).toBe(10)
  })

  it('取消信号原样递到每一次请求上', async () => {
    const controller = new AbortController()

    await readPointSeries([request('a', 'src:p1')], controller.signal, NOW)

    expect(aggregateMock.mock.calls[0]?.[1]).toBe(controller.signal)
  })
})

describe('桶宽与切段', () => {
  it('没配桶宽时按窗口长度自动选一档', async () => {
    await readPointSeries([request('a', 'src:p1')], undefined, NOW)

    expect(callAt(0).interval).toBe('30s')
  })

  it('认不出的桶宽写法回落自动档，不硬喂给接口换一个 422', async () => {
    await readPointSeries(
      [
        request('a', 'src:p1', {
          range: { lastWindow: '2h' },
          interval: '7分钟',
        }),
      ],
      undefined,
      NOW,
    )

    expect(callAt(0).interval).toBe('1m')
  })

  it('⚠ 明确选的档不因窗口太长被降档：一年日历切成两段各问一次', async () => {
    const boundary = NOW - 175 * DAY
    const earliest = NOW - 300 * DAY
    const latest = NOW - DAY
    aggregateMock
      .mockResolvedValueOnce(
        aggregate([
          { node_key: 'src:p1', at: earliest, value: 1 },
          { node_key: 'src:p1', at: boundary, value: 2 },
        ]),
      )
      .mockResolvedValueOnce(
        aggregate([
          { node_key: 'src:p1', at: boundary, value: 2 },
          { node_key: 'src:p1', at: latest, value: 3 },
        ]),
      )

    const found = await readPointSeries(
      [
        request('a', 'src:p1', {
          range: { lastWindow: '365d' },
          interval: '1d',
        }),
      ],
      undefined,
      NOW,
    )

    expect(aggregateMock).toHaveBeenCalledTimes(2)
    expect(callAt(0).interval).toBe('1d')
    expect(callAt(0).toMs).toBe(NOW - 175 * DAY)
    expect(callAt(1).fromMs).toBe(NOW - 175 * DAY)
    expect(callAt(1).toMs).toBe(NOW)
    // ⚠ 段与段的边界那一格两边都会回，拼起来只许留一份
    expect(found.get('a')).toMatchObject({
      state: 'ok',
      points: [
        { t: earliest, v: 1 },
        { t: boundary, v: 2 },
        { t: latest, v: 3 },
      ],
    })
  })

  it('窗口塌成一个瞬间时也问一次，不是零次', async () => {
    await readPointSeries(
      [request('a', 'src:p1', { range: { fromMs: NOW, toMs: NOW } })],
      undefined,
      NOW,
    )

    expect(aggregateMock).toHaveBeenCalledTimes(1)
    expect(callAt(0).fromMs).toBe(NOW)
  })
})

describe('结论', () => {
  it('没配聚合档位时跟服务端缺省走，配了就照配的发', async () => {
    await readPointSeries(
      [request('a', 'src:p1'), request('b', 'src:p2', { aggregate: 'max' })],
      undefined,
      NOW,
    )

    expect(callAt(0).aggregate).toBe('avg')
    expect(callAt(1).aggregate).toBe('max')
  })

  it('窗内 0 点是 ok 加空序列，不是取不到', async () => {
    const found = await readPointSeries(
      [request('a', 'src:p1')],
      undefined,
      NOW,
    )

    expect(found.get('a')).toEqual({
      state: 'ok',
      points: [],
      isTruncated: false,
      isStale: false,
    })
  })

  it('触顶方向原样透传：聚合砍掉的是更晚那一段', async () => {
    aggregateMock.mockResolvedValue(aggregate([], true))

    const found = await readPointSeries(
      [request('a', 'src:p1')],
      undefined,
      NOW,
    )

    expect(found.get('a')).toMatchObject({
      isTruncated: true,
      truncatedSide: 'late',
    })
  })

  it('没触顶就不写方向，免得文案照着一个不存在的方向说', async () => {
    const found = await readPointSeries(
      [request('a', 'src:p1')],
      undefined,
      NOW,
    )

    expect(found.get('a')).not.toHaveProperty('truncatedSide')
  })

  it('回参里冒出没问过的点位也不会串到别的槽上', async () => {
    aggregateMock.mockResolvedValue(
      aggregate([
        {
          node_key: 'src:other',
          at: Date.parse('2026-08-14T11:30:00Z'),
          value: 9,
        },
      ]),
    )

    const found = await readPointSeries(
      [request('a', 'src:p1')],
      undefined,
      NOW,
    )

    expect(found.get('a')).toMatchObject({ state: 'ok', points: [] })
  })
})

describe('失败', () => {
  it('⚠ 认不出的相对窗落 invalid-query，不是静默回落一小时', async () => {
    const found = await readPointSeries(
      [request('a', 'src:p1', { range: { lastWindow: '1w' } })],
      undefined,
      NOW,
    )

    expect(aggregateMock).not.toHaveBeenCalled()
    expect(found.get('a')).toEqual({
      state: 'error',
      message: expect.stringContaining('1w'),
    })
  })

  it('一组取不到不拖垮另一组', async () => {
    aggregateMock
      .mockRejectedValueOnce(new Error('后端挂了'))
      .mockResolvedValueOnce(aggregate())

    const found = await readPointSeries(
      [
        request('a', 'src:p1'),
        request('b', 'src:p2', { range: { lastWindow: '2h' } }),
      ],
      undefined,
      NOW,
    )

    expect(found.get('a')).toEqual({ state: 'error', message: '后端挂了' })
    expect(found.get('b')).toMatchObject({ state: 'ok' })
  })

  it('不是 Error 的东西也说得出一句话', async () => {
    aggregateMock.mockRejectedValue('说不清')

    const found = await readPointSeries(
      [request('a', 'src:p1')],
      undefined,
      NOW,
    )

    expect(found.get('a')).toEqual({ state: 'error', message: '说不清' })
  })
})
