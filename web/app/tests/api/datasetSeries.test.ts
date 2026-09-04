/**
 * @fileoverview 锁住台账序列批量取数：同表同窗的多列并成一次 `:series`、台账那套
 * 线形逐点转成 `HistoryPoint`、触顶砍的是更早那一头。
 * ⚠ 台账编码解不出表时必须诚实报错：清单装不下一页与「没有这张表」是两回事，
 * 说成后者等于把翻页没翻到栽给用户的配置。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DatasetSeries, DatasetTableSummary, Page } from '@dt/contracts'

import * as dataset from '@/api/dataset'
import {
  __resetDatasetTables,
  readDatasetSeries,
  type DatasetSeriesRequest,
} from '@/api/datasetSeries'

const NOW = Date.parse('2026-08-14T12:00:00Z')

let seriesMock: ReturnType<typeof vi.fn>
let tablesMock: ReturnType<typeof vi.fn>

function table(code: string, id: string): DatasetTableSummary {
  return {
    id,
    code,
    name: `${code} 台账`,
    description: null,
    collect_mode: 'aggregate',
    collect_interval_ms: 60_000,
    retention_days: null,
    last_collected_ts: null,
    is_enabled: true,
    column_count: 3,
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-01T00:00:00Z',
  }
}

function tablePage(
  items: DatasetTableSummary[],
  total = items.length,
): Page<DatasetTableSummary> {
  return { items, page: 1, size: 200, total }
}

function series(
  columns: Record<string, { ts: string; value: unknown }[]>,
  isTruncated = false,
): DatasetSeries {
  return { series: columns, is_truncated: isTruncated, limit: 20_000 }
}

function request(
  fieldKey: string,
  datasetKey: string,
  range: DatasetSeriesRequest['detail']['range'] = { lastWindow: '1h' },
): DatasetSeriesRequest {
  return { fieldKey, detail: { datasetKey, range } }
}

beforeEach(() => {
  __resetDatasetTables()
  tablesMock = vi.fn().mockResolvedValue(tablePage([table('energy', 't-1')]))
  seriesMock = vi.fn().mockResolvedValue(series({}))
  vi.spyOn(dataset, 'listDatasetTables').mockImplementation(tablesMock)
  vi.spyOn(dataset, 'getDatasetSeries').mockImplementation(seriesMock)
})

afterEach(() => {
  vi.restoreAllMocks()
  __resetDatasetTables()
})

describe('批量合并', () => {
  it('同一张表同一段窗口的 3 列并成一次请求', async () => {
    const found = await readDatasetSeries(
      [
        request('a', 'ds:energy:kwh'),
        request('b', 'ds:energy:cost'),
        request('c', 'ds:energy:rate'),
      ],
      undefined,
      NOW,
    )

    expect(seriesMock).toHaveBeenCalledTimes(1)
    expect(seriesMock.mock.calls[0]?.[0]).toBe('t-1')
    expect(seriesMock.mock.calls[0]?.[1]).toEqual(['kwh', 'cost', 'rate'])
    expect(found.size).toBe(3)
  })

  it('同一列被两个槽绑着只问一次，两个槽拿到同一条序列', async () => {
    seriesMock.mockResolvedValue(
      series({ kwh: [{ ts: '2026-08-14T11:10:00Z', value: 3 }] }),
    )

    const found = await readDatasetSeries(
      [request('a', 'ds:energy:kwh'), request('b', 'ds:energy:kwh')],
      undefined,
      NOW,
    )

    expect(seriesMock).toHaveBeenCalledTimes(1)
    expect(seriesMock.mock.calls[0]?.[1]).toEqual(['kwh'])
    const point = { t: Date.parse('2026-08-14T11:10:00Z'), v: 3 }
    expect(found.get('a')).toMatchObject({ state: 'ok', points: [point] })
    expect(found.get('b')).toMatchObject({ state: 'ok', points: [point] })
  })

  it('窗口不同的两列各问各的', async () => {
    await readDatasetSeries(
      [
        request('a', 'ds:energy:kwh'),
        request('b', 'ds:energy:cost', { lastWindow: '2h' }),
      ],
      undefined,
      NOW,
    )

    expect(seriesMock).toHaveBeenCalledTimes(2)
  })

  it('超过 50 列切成两次请求', async () => {
    const wanted = Array.from({ length: 60 }, (_, index) =>
      request(`s${index}`, `ds:energy:c${index}`),
    )

    await readDatasetSeries(wanted, undefined, NOW)

    expect(seriesMock).toHaveBeenCalledTimes(2)
    expect((seriesMock.mock.calls[0]?.[1] as string[]).length).toBe(50)
    expect((seriesMock.mock.calls[1]?.[1] as string[]).length).toBe(10)
  })

  it('台账清单只拉一次，之后的取数吃缓存', async () => {
    await readDatasetSeries([request('a', 'ds:energy:kwh')], undefined, NOW)
    await readDatasetSeries([request('b', 'ds:energy:cost')], undefined, NOW)

    expect(tablesMock).toHaveBeenCalledTimes(1)
  })

  it('取消信号原样递到每一次请求上', async () => {
    const controller = new AbortController()

    await readDatasetSeries(
      [request('a', 'ds:energy:kwh')],
      controller.signal,
      NOW,
    )

    expect(seriesMock.mock.calls[0]?.[3]).toBe(controller.signal)
  })

  it('一条都拆不动时连台账清单都不拉', async () => {
    const found = await readDatasetSeries(
      [request('a', '乱写')],
      undefined,
      NOW,
    )

    expect(tablesMock).not.toHaveBeenCalled()
    expect(found.get('a')).toMatchObject({ state: 'error' })
  })
})

describe('线形转换', () => {
  it('ts 转成 UTC 毫秒、value 转成 v，窗口下发成两个 ISO 串', async () => {
    seriesMock.mockResolvedValue(
      series({
        kwh: [
          { ts: '2026-08-14T11:10:00Z', value: 1.5 },
          { ts: '2026-08-14T11:20:00Z', value: 2.5 },
        ],
      }),
    )

    const found = await readDatasetSeries(
      [request('a', 'ds:energy:kwh')],
      undefined,
      NOW,
    )

    expect(seriesMock.mock.calls[0]?.[2]).toEqual({
      since: '2026-08-14T11:00:00.000Z',
      until: '2026-08-14T12:00:00.000Z',
    })
    expect(found.get('a')).toMatchObject({
      state: 'ok',
      points: [
        { t: Date.parse('2026-08-14T11:10:00Z'), v: 1.5 },
        { t: Date.parse('2026-08-14T11:20:00Z'), v: 2.5 },
      ],
      isStale: false,
    })
  })

  it('⚠ limit 在这一支无处可放，显式丢掉而不是拼进查询', async () => {
    await readDatasetSeries(
      [request('a', 'ds:energy:kwh', { lastWindow: '1h', limit: 10 })],
      undefined,
      NOW,
    )

    expect(seriesMock.mock.calls[0]?.[2]).toEqual({
      since: '2026-08-14T11:00:00.000Z',
      until: '2026-08-14T12:00:00.000Z',
    })
  })

  it('触顶砍掉的是更早那一段', async () => {
    seriesMock.mockResolvedValue(series({ kwh: [] }, true))

    const found = await readDatasetSeries(
      [request('a', 'ds:energy:kwh')],
      undefined,
      NOW,
    )

    expect(found.get('a')).toMatchObject({
      isTruncated: true,
      truncatedSide: 'early',
    })
  })

  it('窗内 0 行是 ok 加空序列；回参里缺了这一列也一样', async () => {
    seriesMock.mockResolvedValue(series({ kwh: [] }))

    const found = await readDatasetSeries(
      [request('a', 'ds:energy:kwh'), request('b', 'ds:energy:cost')],
      undefined,
      NOW,
    )

    expect(found.get('a')).toEqual({
      state: 'ok',
      points: [],
      isTruncated: false,
      isStale: false,
    })
    expect(found.get('b')).toMatchObject({ state: 'ok', points: [] })
  })
})

describe('解不出表', () => {
  it('身份串不是 ds:编码:列 的写法时当场说破', async () => {
    const found = await readDatasetSeries(
      [request('a', 'energy:kwh')],
      undefined,
      NOW,
    )

    expect(found.get('a')).toEqual({
      state: 'error',
      message: expect.stringContaining('ds:台账编码:列标识'),
    })
  })

  it('⚠ 台账装不下一页时报「超过一页」，不是「没有这张表」', async () => {
    tablesMock.mockResolvedValue(tablePage([table('other', 't-9')], 240))

    const found = await readDatasetSeries(
      [request('a', 'ds:energy:kwh')],
      undefined,
      NOW,
    )

    expect(seriesMock).not.toHaveBeenCalled()
    expect(found.get('a')).toEqual({
      state: 'error',
      message: expect.stringContaining('台账超过一页'),
    })
  })

  it('清单里没有这个编码时说的是找不到这张表', async () => {
    const found = await readDatasetSeries(
      [request('a', 'ds:missing:kwh'), request('b', 'ds:energy:kwh')],
      undefined,
      NOW,
    )

    expect(found.get('a')).toEqual({
      state: 'error',
      message: expect.stringContaining('找不到台账编码 missing'),
    })
    expect(found.get('b')).toMatchObject({ state: 'ok' })
  })

  it('清单取不到不缓存：抖一次之后下一拍还能解出来', async () => {
    tablesMock.mockRejectedValueOnce(new Error('清单挂了'))

    const first = await readDatasetSeries(
      [request('a', 'ds:energy:kwh')],
      undefined,
      NOW,
    )
    const second = await readDatasetSeries(
      [request('b', 'ds:energy:kwh')],
      undefined,
      NOW,
    )

    expect(first.get('a')).toEqual({ state: 'error', message: '清单挂了' })
    expect(second.get('b')).toMatchObject({ state: 'ok' })
    expect(tablesMock).toHaveBeenCalledTimes(2)
  })

  it('认不出的相对窗落 invalid-query，不是静默回落一小时', async () => {
    const found = await readDatasetSeries(
      [request('a', 'ds:energy:kwh', { lastWindow: '30min' })],
      undefined,
      NOW,
    )

    expect(seriesMock).not.toHaveBeenCalled()
    expect(found.get('a')).toEqual({
      state: 'error',
      message: expect.stringContaining('30min'),
    })
  })
})

describe('取数失败', () => {
  it('一组取不到不拖垮另一组', async () => {
    seriesMock
      .mockRejectedValueOnce(new Error('后端挂了'))
      .mockResolvedValueOnce(series({ cost: [] }))

    const found = await readDatasetSeries(
      [
        request('a', 'ds:energy:kwh'),
        request('b', 'ds:energy:cost', { lastWindow: '2h' }),
      ],
      undefined,
      NOW,
    )

    expect(found.get('a')).toEqual({ state: 'error', message: '后端挂了' })
    expect(found.get('b')).toMatchObject({ state: 'ok' })
  })

  it('不是 Error 的东西也说得出一句话', async () => {
    seriesMock.mockRejectedValue('说不清')

    const found = await readDatasetSeries(
      [request('a', 'ds:energy:kwh')],
      undefined,
      NOW,
    )

    expect(found.get('a')).toEqual({ state: 'error', message: '说不清' })
  })
})
