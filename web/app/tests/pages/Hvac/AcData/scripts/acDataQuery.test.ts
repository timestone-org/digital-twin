/**
 * @fileoverview 锁住原始数据页的取值规则：默认区间、区间校验、默认画哪几条、
 * 以及聚合序列摊成折线时 null 必须留成 null。
 *
 * ⚠ 「空桶留 null」是这块最容易被顺手改掉的：跳过空点会让断档连成一条直线，
 * 看上去像一段平稳运行的数据。
 */
import { describe, expect, it } from 'vitest'
import type { AcMetric, RawSeries } from '@dt/contracts'

import {
  MAX_CHARTED_METRICS,
  defaultMetrics,
  defaultRange,
  rangeOfLastHours,
  rangeProblem,
  toChartSeries,
  toggleMetric,
} from '@/pages/Hvac/AcData/scripts/acDataQuery'

const NOW = new Date('2026-08-12T06:00:00.000Z')

function metric(over: Partial<AcMetric> & { key: string }): AcMetric {
  return {
    name: over.key,
    unit: '℃',
    group: 'temperature',
    is_limitable: false,
    is_charted_by_default: false,
    ...over,
  }
}

describe('时间区间', () => {
  it('默认区间是截止此刻往前 6 小时，两端都是 UTC RFC3339', () => {
    expect(defaultRange(NOW)).toEqual({
      from: '2026-08-12T00:00:00.000Z',
      to: '2026-08-12T06:00:00.000Z',
    })
  })

  it('预设按小时回看', () => {
    expect(rangeOfLastHours(1, NOW).from).toBe('2026-08-12T05:00:00.000Z')
    expect(rangeOfLastHours(24, NOW).from).toBe('2026-08-11T06:00:00.000Z')
  })

  it('两端都选上才算可取数', () => {
    expect(
      rangeProblem({ from: '', to: '2026-08-12T06:00:00.000Z' }),
    ).toContain('都选上')
    expect(
      rangeProblem({ from: '2026-08-12T00:00:00.000Z', to: '' }),
    ).toContain('都选上')
  })

  it('倒置的区间就地拦下，不必等后端的 41613', () => {
    expect(
      rangeProblem({
        from: '2026-08-12T06:00:00.000Z',
        to: '2026-08-12T00:00:00.000Z',
      }),
    ).toContain('早于')
  })

  it('起止相同也算倒置——区间是半开的，取不到任何一行', () => {
    const same = '2026-08-12T06:00:00.000Z'
    expect(rangeProblem({ from: same, to: same })).not.toBeNull()
  })

  it('正常区间没有问题', () => {
    expect(rangeProblem(defaultRange(NOW))).toBeNull()
  })
})

describe('默认画哪几条', () => {
  it('取目录里标了 is_charted_by_default 的', () => {
    const metrics = [
      metric({ key: 'a', is_charted_by_default: true }),
      metric({ key: 'b' }),
      metric({ key: 'c', is_charted_by_default: true }),
    ]
    expect(defaultMetrics(metrics)).toEqual(['a', 'c'])
  })

  it('目录标了一大堆时也不超过上限', () => {
    const metrics = Array.from({ length: 12 }, (_unused, index) =>
      metric({ key: `m${index}`, is_charted_by_default: true }),
    )
    expect(defaultMetrics(metrics)).toHaveLength(MAX_CHARTED_METRICS)
  })

  it('一个都没标时给空数组，而不是自作主张挑几个', () => {
    expect(defaultMetrics([metric({ key: 'a' })])).toEqual([])
  })
})

describe('勾选指标', () => {
  it('没选过就加上，选过就去掉', () => {
    expect(toggleMetric(['a'], 'b')).toEqual(['a', 'b'])
    expect(toggleMetric(['a', 'b'], 'a')).toEqual(['b'])
  })

  it('到上限后再点别的不生效——再多就分不清颜色了', () => {
    const full = Array.from({ length: MAX_CHARTED_METRICS }, (_u, i) => `m${i}`)
    expect(toggleMetric(full, 'extra')).toEqual(full)
  })

  it('到上限后仍然可以取消已选的', () => {
    const full = Array.from({ length: MAX_CHARTED_METRICS }, (_u, i) => `m${i}`)
    expect(toggleMetric(full, 'm0')).toHaveLength(MAX_CHARTED_METRICS - 1)
  })
})

describe('聚合序列摊成折线', () => {
  const catalog = [
    metric({ key: 'workshop_temp_avg', name: '车间温度' }),
    metric({
      key: 'workshop_humidity_avg',
      name: '车间湿度',
      unit: '%',
      group: 'humidity',
    }),
  ]

  const series: RawSeries = {
    interval_minutes: 5,
    metrics: ['workshop_temp_avg', 'workshop_humidity_avg'],
    points: [
      {
        ts: '2026-08-12T00:00:00.000Z',
        values: { workshop_temp_avg: 21.5, workshop_humidity_avg: 55 },
      },
      {
        ts: '2026-08-12T00:05:00.000Z',
        values: { workshop_temp_avg: null, workshop_humidity_avg: 56 },
      },
    ],
  }

  it('每个指标一条系列，名字与量纲取自目录', () => {
    const [first, second] = toChartSeries(series, catalog)
    expect(first?.name).toBe('车间温度')
    expect(first?.unit).toBe('℃')
    expect(second?.unit).toBe('%')
  })

  it('分组直接当 Y 轴用：温度与湿度因此各占一边', () => {
    const [first, second] = toChartSeries(series, catalog)
    expect(first?.axis).toBe('temperature')
    expect(second?.axis).toBe('humidity')
  })

  it('空桶留成 null 而不是跳过——跳过会把断档连成直线', () => {
    const [first] = toChartSeries(series, catalog)
    expect(first?.points).toEqual([
      ['2026-08-12T00:00:00.000Z', 21.5],
      ['2026-08-12T00:05:00.000Z', null],
    ])
  })

  it('某个桶里压根没有这个键时同样是 null', () => {
    const sparse: RawSeries = {
      interval_minutes: 5,
      metrics: ['workshop_temp_avg'],
      points: [{ ts: '2026-08-12T00:00:00.000Z', values: {} }],
    }
    expect(toChartSeries(sparse, catalog)[0]?.points[0]?.[1]).toBeNull()
  })

  it('目录里查不到的指标退回用 key 当名字，不至于渲染成空白', () => {
    const unknown: RawSeries = {
      interval_minutes: 5,
      metrics: ['brand_new_metric'],
      points: [],
    }
    const [only] = toChartSeries(unknown, catalog)
    expect(only?.name).toBe('brand_new_metric')
    expect(only?.axis).toBe('default')
  })

  it('没有点时给空系列，不抛错', () => {
    const blank: RawSeries = { interval_minutes: 1, metrics: [], points: [] }
    expect(toChartSeries(blank, catalog)).toEqual([])
  })
})
