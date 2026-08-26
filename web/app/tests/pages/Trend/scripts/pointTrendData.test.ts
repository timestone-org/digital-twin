/**
 * @fileoverview 锁住点位那一面的两件纯活：把采集点位摊成勾选项，以及一批点位
 * **一次请求问完**、按点位归位、空格按各自的归档心跳补上一个读数。
 *
 * ⚠ 一个点位一次请求的老写法在这里是不许回去的：8 个点位就是 8 条各自会失败
 * 的链路，而半张图在界面上与「那几个点位没数据」长得一模一样。
 * ⚠ 补格那条是真会静默出错的：订阅 + 死区模式下采集器只在值变了才写一条，照
 * 「没有样本就是没有数据」画，一条平稳运行的曲线会变成一片虚线。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CollectHistoryAggregate, CollectPoint } from '@dt/contracts'

import * as histories from '@/api/pointHistories'
import {
  readPointReadings,
  toTrendItem,
} from '@/pages/Trend/scripts/pointTrendData'

function point(over: Partial<CollectPoint> = {}): CollectPoint {
  return {
    id: 'p1',
    source_id: 's1',
    node_key: 's1:p1',
    code: 'p1',
    name: '车间温度',
    address: 'ns=2;s=T1',
    data_type: 'float',
    unit: '℃',
    sampling_interval_ms: 1000,
    deadband: 0,
    archive_enabled: true,
    archive_max_interval_ms: 60_000,
    archive_retention_days: null,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
    ...over,
  }
}

const FROM = Date.parse('2026-08-24T00:00:00.000Z')
const TO = Date.parse('2026-08-24T06:00:00.000Z')

function aggregate(
  over: Partial<CollectHistoryAggregate> = {},
): CollectHistoryAggregate {
  return {
    items: [],
    interval: '2m',
    aggregate: 'avg',
    timezone: 'Asia/Shanghai',
    is_truncated: false,
    ...over,
  }
}

function bucket(nodeKey: string, minute: number, value: number | null) {
  return {
    node_key: nodeKey,
    bucket_start: new Date(FROM + minute * 60_000).toISOString(),
    value,
    sample_count: 1,
  }
}

/** 一次取数的入参，只覆盖这一条用例关心的那几样。 */
function query(over: Partial<Parameters<typeof readPointReadings>[0]> = {}) {
  return {
    wanted: [toTrendItem(point())],
    fromMs: FROM,
    toMs: TO,
    aggregate: 'avg',
    interval: 'auto',
    ...over,
  }
}

beforeEach(() => {
  vi.spyOn(histories, 'fetchPointAggregate').mockResolvedValue(aggregate())
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('摊成勾选项', () => {
  it('量纲进名字，也当 Y 轴分组键', () => {
    const item = toTrendItem(point())
    expect(item.label).toBe('车间温度（℃）')
    expect(item.unit).toBe('℃')
    expect(item.key).toBe('s1:p1')
    expect(item.isDrawable).toBe(true)
  })

  it('⚠ 没开归档的点位当场标出来：它永远取不到一条读数', () => {
    const item = toTrendItem(point({ archive_enabled: false }))
    expect(item.label).toContain('未记录历史')
    expect(item.isDrawable).toBe(false)
  })

  it('没有量纲时不硬编一个空括号', () => {
    expect(toTrendItem(point({ unit: null })).label).toBe('车间温度')
  })

  it('⚠ 结转上限取这个点位自己的归档心跳，不是一个全局常数', () => {
    expect(toTrendItem(point({ archive_max_interval_ms: 5_000 })).holdMs).toBe(
      5_000,
    )
  })
})

describe('取一批点位的分桶读数', () => {
  it('⚠ 一次请求问完全部点位，不是一个点位一次', async () => {
    await readPointReadings(
      query({
        wanted: [
          toTrendItem(point()),
          toTrendItem(point({ node_key: 's1:p2' })),
        ],
      }),
    )
    const spy = vi.mocked(histories.fetchPointAggregate)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0]?.[0].nodeKeys).toEqual(['s1:p1', 's1:p2'])
  })

  it('自动档按窗口选间隔，档位与折算一起下去', async () => {
    const result = await readPointReadings(query({ aggregate: 'max' }))
    const sent = vi.mocked(histories.fetchPointAggregate).mock.calls[0]?.[0]
    // 6 小时 / 190 格上限 → 落在 2 分钟这一档
    expect(sent?.interval).toBe('2m')
    expect(sent?.aggregate).toBe('max')
    expect(result.bucket.ms).toBe(120_000)
  })

  it('手选的间隔原样下去，不被自动档盖掉', async () => {
    const result = await readPointReadings(query({ interval: '30m' }))
    const sent = vi.mocked(histories.fetchPointAggregate).mock.calls[0]?.[0]
    expect(sent?.interval).toBe('30m')
    expect(result.bucket.ms).toBe(1_800_000)
  })

  it('⚠ 手选的间隔细到会问超上限时回落自动档，而不是换回半截曲线', async () => {
    const result = await readPointReadings(query({ interval: '1s' }))
    expect(
      vi.mocked(histories.fetchPointAggregate).mock.calls[0]?.[0].interval,
    ).toBe('2m')
    expect(result.bucket.value).toBe('2m')
  })

  it('按点位归位；一格都没有的点位回一条空序列而不是不出现', async () => {
    vi.mocked(histories.fetchPointAggregate).mockResolvedValue(
      aggregate({ items: [bucket('s1:p1', 0, 21)] }),
    )
    const result = await readPointReadings(
      query({
        wanted: [
          toTrendItem(point()),
          toTrendItem(point({ node_key: 's1:p2' })),
        ],
      }),
    )
    expect(result.readings.map((one) => one.key)).toEqual(['s1:p1', 's1:p2'])
    expect(result.readings[1]?.points).toEqual([])
  })

  it('⚠ 空掉的格保持上一个读数，别把「值没变」画成一片虚线', async () => {
    vi.mocked(histories.fetchPointAggregate).mockResolvedValue(
      aggregate({ items: [bucket('s1:p1', 0, 21), bucket('s1:p1', 6, 22)] }),
    )
    // 心跳 60 秒 ÷ 2 分钟一格 → 只结转 1 格；中间空了 2 格，剩下的画成断档
    const result = await readPointReadings(query())
    expect(result.readings[0]?.points.slice(0, 4).map((one) => one.v)).toEqual([
      21,
      21,
      null,
      22,
    ])
  })

  it('心跳够长时一路结转到下一条读数，中间不出现断档', async () => {
    vi.mocked(histories.fetchPointAggregate).mockResolvedValue(
      aggregate({ items: [bucket('s1:p1', 0, 21), bucket('s1:p1', 6, 22)] }),
    )
    const result = await readPointReadings(
      query({
        wanted: [toTrendItem(point({ archive_max_interval_ms: 3_600_000 }))],
      }),
    )
    expect(result.readings[0]?.points.slice(0, 4).map((one) => one.v)).toEqual([
      21, 21, 21, 22,
    ])
  })

  it('⚠ 末尾那一段照同一条规则结转：采集停了之后曲线只再走一个心跳', async () => {
    vi.mocked(histories.fetchPointAggregate).mockResolvedValue(
      aggregate({ items: [bucket('s1:p1', 0, 21)] }),
    )
    // 窗口 6 小时、最后一条读数在第 0 分钟、心跳 60 秒、一格 2 分钟
    // → 结转 1 格就停，而不是一路平推到窗口右端
    const result = await readPointReadings(query())
    const points = result.readings[0]?.points ?? []
    expect(points.map((one) => one.v)).toEqual([21, 21])
    expect(points.at(-1)?.t).toBe(FROM + 120_000)
  })

  it('触顶如实带上来', async () => {
    vi.mocked(histories.fetchPointAggregate).mockResolvedValue(
      aggregate({ is_truncated: true }),
    )
    const result = await readPointReadings(query())
    expect(result.isTruncated).toBe(true)
  })

  it('⚠ 取数失败整次就 reject，绝不返回半张图', async () => {
    vi.mocked(histories.fetchPointAggregate).mockRejectedValue(
      new Error('归档库连不上'),
    )
    await expect(readPointReadings(query())).rejects.toThrow('归档库连不上')
  })
})
