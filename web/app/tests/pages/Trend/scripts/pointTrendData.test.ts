/**
 * @fileoverview 锁住点位那一面的两件纯活：没开归档的点位必须在名字上标出来，
 * 以及一批点位**一次请求问完**、按点位归位、桶与桶之间的空洞画成断档。
 *
 * ⚠ 一个点位一次请求的老写法在这里是不许回去的：8 个点位就是 8 条各自会失败
 * 的链路，而半张图在界面上与「那几个点位没数据」长得一模一样。
 * ⚠ 断档那条是真会静默出错的：不插 null 的话 echarts 把空洞两端连成一条直线，
 * 那条直线看着像「值一直在平稳变化」，而那段时间一条读数都没有。
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
})

describe('取一批点位的分桶读数', () => {
  it('⚠ 一次请求问完全部点位，不是一个点位一次', async () => {
    await readPointReadings(
      [toTrendItem(point()), toTrendItem(point({ node_key: 's1:p2' }))],
      FROM,
      TO,
      'avg',
    )
    const spy = vi.mocked(histories.fetchPointAggregate)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0]?.[0].nodeKeys).toEqual(['s1:p1', 's1:p2'])
  })

  it('桶宽按窗口自己选，档位与折算一起下去', async () => {
    const result = await readPointReadings(
      [toTrendItem(point())],
      FROM,
      TO,
      'max',
    )
    const sent = vi.mocked(histories.fetchPointAggregate).mock.calls[0]?.[0]
    // 6 小时 / 190 格上限 → 落在 2 分钟这一档
    expect(sent?.interval).toBe('2m')
    expect(sent?.aggregate).toBe('max')
    expect(result.bucket.ms).toBe(120_000)
  })

  it('按点位归位；一格都没有的点位回一条空序列而不是不出现', async () => {
    vi.mocked(histories.fetchPointAggregate).mockResolvedValue(
      aggregate({ items: [bucket('s1:p1', 0, 21)] }),
    )
    const result = await readPointReadings(
      [toTrendItem(point()), toTrendItem(point({ node_key: 's1:p2' }))],
      FROM,
      TO,
      'avg',
    )
    expect(result.readings.map((one) => one.key)).toEqual(['s1:p1', 's1:p2'])
    expect(result.readings[1]?.points).toEqual([])
  })

  it('⚠ 桶之间空过一大截时插一个断档点，别让两端被连成一条直线', async () => {
    vi.mocked(histories.fetchPointAggregate).mockResolvedValue(
      aggregate({
        items: [
          bucket('s1:p1', 0, 21),
          bucket('s1:p1', 2, 22),
          bucket('s1:p1', 30, 23),
        ],
      }),
    )
    const result = await readPointReadings(
      [toTrendItem(point())],
      FROM,
      TO,
      'avg',
    )
    expect(result.readings[0]?.points.map((one) => one.v)).toEqual([
      21,
      22,
      null,
      23,
    ])
  })

  it('触顶如实带上来', async () => {
    vi.mocked(histories.fetchPointAggregate).mockResolvedValue(
      aggregate({ is_truncated: true }),
    )
    const result = await readPointReadings(
      [toTrendItem(point())],
      FROM,
      TO,
      'avg',
    )
    expect(result.isTruncated).toBe(true)
  })

  it('⚠ 取数失败整次就 reject，绝不返回半张图', async () => {
    vi.mocked(histories.fetchPointAggregate).mockRejectedValue(
      new Error('归档库连不上'),
    )
    await expect(
      readPointReadings([toTrendItem(point())], FROM, TO, 'avg'),
    ).rejects.toThrow('归档库连不上')
  })
})
