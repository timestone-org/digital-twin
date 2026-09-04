/**
 * @fileoverview 锁住点位序列批量取数的合并口径：同窗同档并成一次请求、长窗按
 * 明确桶宽切段后拼接、触顶方向原样透传，以及认不出的相对窗落 invalid-query。
 * ⚠ 「窗内 0 点」是 ok 加空序列，「取不到」才是 error——两者不许长成一个样。
 * ⚠ 切段这一段守三件事：段起点落在桶网格上、段数有上限、超了整窗降档并说出来。
 * 断言不写死时区：段起点按「当地零点」判，它在任何时区下都是 00:00:00.000。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CollectHistoryAggregate } from '@dt/contracts'

import * as histories from '@/api/pointHistories'
import { isBucketOutOfReach, readPointSeries } from '@/api/pointSeries'
import type { PointSeriesRequest } from '@/api/pointSeries'
import { TREND_BUCKET_AUTO } from '@/features/trend/trendBucket'

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

/** 一年日历那一条：365 天窗配日桶，切得出两段。 */
function calendarYear(): PointSeriesRequest {
  return request('a', 'src:p1', {
    range: { lastWindow: '365d' },
    interval: '1d',
  })
}

/**
 * 一个时刻的当地时分秒毫秒。
 * ⚠ 断言桶网格只能这么写：当地零点在任何时区下都是 00:00:00.000，而写死一个
 * 毫秒数的话，开发机（东八区）绿、CI（可能是 UTC）红。
 */
function localParts(at: unknown): number[] {
  const one = new Date(at as number)
  return [
    one.getHours(),
    one.getMinutes(),
    one.getSeconds(),
    one.getMilliseconds(),
  ]
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
    const earliest = NOW - 300 * DAY
    const latest = NOW - DAY
    aggregateMock
      .mockResolvedValueOnce(
        aggregate([{ node_key: 'src:p1', at: earliest, value: 1 }]),
      )
      .mockResolvedValueOnce(
        aggregate([{ node_key: 'src:p1', at: latest, value: 3 }]),
      )

    const found = await readPointSeries([calendarYear()], undefined, NOW)

    expect(aggregateMock).toHaveBeenCalledTimes(2)
    expect(callAt(0).interval).toBe('1d')
    expect(callAt(1).fromMs).toBe(callAt(0).toMs)
    expect(callAt(1).toMs).toBe(NOW)
    expect(found.get('a')).toMatchObject({
      state: 'ok',
      points: [
        { t: earliest, v: 1 },
        { t: latest, v: 3 },
      ],
    })
  })

  it('⚠ 段起点吸附到桶网格：日桶按当地零点切，不从窗口左端那个任意毫秒切', async () => {
    // ⚠ 库里的分桶是全局对齐的：段起点落在格子中间时，边界那一格被切成两半、
    // 两段各回半格，拼起来只留得下前一段那半格——sum / count 档就这么少一截，
    // 而曲线本身完全合法，屏上看不出任何异常
    await readPointSeries([calendarYear()], undefined, NOW)

    expect(localParts(callAt(0).fromMs)).toEqual([0, 0, 0, 0])
    expect(callAt(0).toMs).toBe((callAt(0).fromMs as number) + 190 * DAY)
    expect(callAt(0).fromMs).toBeLessThanOrEqual(NOW - 365 * DAY)
  })

  it('⚠ 秒档同样吸附：窗口左端是「此刻减相对窗」，几乎不落在格子上', async () => {
    const odd = NOW + 1234

    await readPointSeries(
      [
        request('a', 'src:p1', {
          range: { lastWindow: '10m' },
          interval: '1s',
        }),
      ],
      undefined,
      odd,
    )

    expect((callAt(0).fromMs as number) % 1000).toBe(0)
    expect(callAt(0).toMs).toBe((callAt(0).fromMs as number) + 190_000)
    expect(callAt(1).fromMs).toBe(callAt(0).toMs)
  })

  it('⚠ 切出来的几段一起发，不是一段等一段', async () => {
    // 串行的话首帧要等段数乘以一次往返，而刷新节拍到点就把没跑完的那一轮作废，
    // 于是段一多就永远跑不完；这一刻还没 await，串行只发得出第一段
    const pending = readPointSeries([calendarYear()], undefined, NOW)

    expect(aggregateMock).toHaveBeenCalledTimes(2)

    await pending
  })

  it('⚠ 段数超上限时整窗降档，并如实标出降到了哪一档', async () => {
    // 一年窗配 1 秒一格切得出十六万段，每段一次请求：不设上限就是永远跑不完
    // 且一直压着后端。降档必须说出来——静默降档等于给累积量画一条压扁的假线
    const found = await readPointSeries(
      [
        request('a', 'src:p1', {
          range: { lastWindow: '365d' },
          interval: '1s',
        }),
      ],
      undefined,
      NOW,
    )

    expect(aggregateMock).toHaveBeenCalledTimes(1)
    expect(callAt(0).interval).toBe('2d')
    expect(found.get('a')).toMatchObject({
      state: 'ok',
      coarsenedTo: '2d',
      isTruncated: true,
    })
    // 两头都没被砍，缺的是分辨率：写个方向出去，图例上就会指着一头说瞎话
    expect(found.get('a')).not.toHaveProperty('truncatedSide')
  })

  it('段与段回了同一格时只留一份', async () => {
    const shared = NOW - 200 * DAY
    aggregateMock.mockResolvedValue(
      aggregate([{ node_key: 'src:p1', at: shared, value: 2 }]),
    )

    const found = await readPointSeries([calendarYear()], undefined, NOW)

    expect(found.get('a')).toMatchObject({
      state: 'ok',
      points: [{ t: shared, v: 2 }],
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

describe('档位够不够得着', () => {
  it('自动档永远够得着：它本来就是按整窗挑的', () => {
    expect(isBucketOutOfReach(365 * DAY, TREND_BUCKET_AUTO)).toBe(false)
  })

  it('⚠ 一年窗的日桶够得着：判据是切几段，不是一次问得下几个桶', () => {
    expect(isBucketOutOfReach(365 * DAY, '1d')).toBe(false)
    expect(isBucketOutOfReach(365 * DAY, '12h')).toBe(false)
  })

  it('细到切爆上限的那几档够不着', () => {
    expect(isBucketOutOfReach(365 * DAY, '1s')).toBe(true)
    expect(isBucketOutOfReach(365 * DAY, '1h')).toBe(true)
  })

  it('认不出的写法按自动档算，不会被判成够不着', () => {
    expect(isBucketOutOfReach(365 * DAY, '7分钟')).toBe(false)
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
