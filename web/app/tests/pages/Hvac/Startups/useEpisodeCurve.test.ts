/**
 * @fileoverview 锁住下钻曲线：只画达标看的那两个量、null 保持成缺口、
 * 连点两条时慢的那次不许盖掉新曲线。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AcMetric,
  CursorPage,
  RawSample,
  StartupEpisode,
} from '@dt/contracts'

import * as hvac from '@/api/hvac'
import { useEpisodeCurve } from '@/pages/Hvac/Startups/useEpisodeCurve'

const STAMP = '2026-08-12T02:00:00.000Z'

const BLANK = {
  workshop_humidity_avg: null,
  ac_temp_setpoint: null,
  ac_humidity_setpoint: null,
  fresh_air_temp: null,
  fresh_air_humidity: null,
  supply_air_temp: null,
  supply_air_humidity: null,
  return_air_temp: null,
  return_air_humidity: null,
  mixed_air_temp: null,
  mixed_air_humidity: null,
  chilled_water_supply_temp: null,
  chilled_water_supply_pressure: null,
  heat_steam_temp: null,
  heat_steam_pressure: null,
  humidify_steam_temp: null,
  humidify_steam_pressure: null,
  fan_frequency: null,
}

function sample(ts: string, temp: number | null): RawSample {
  return { ts, ...BLANK, workshop_temp_avg: temp }
}

function page(items: RawSample[]): CursorPage<RawSample> {
  return { items, next: null, has_more: false }
}

function metric(key: string, name: string, group: string): AcMetric {
  return {
    key,
    name,
    unit: group === 'humidity' ? '%' : '℃',
    group: group === 'humidity' ? 'humidity' : 'temperature',
    is_limitable: true,
    is_charted_by_default: true,
  }
}

const CATALOG = [
  metric('workshop_temp_avg', '车间温度', 'temperature'),
  metric('workshop_humidity_avg', '车间湿度', 'humidity'),
]

function episode(over: Partial<StartupEpisode> = {}): StartupEpisode {
  return {
    started_at: STAMP,
    running_set: ['K01'],
    complied_at: '2026-08-12T02:25:00.000Z',
    duration_minutes: 25,
    outcome: 'usable',
    readings: {},
    is_excluded: false,
    exclusion_reason: null,
    ...over,
  }
}

/** 手动结算的 promise，用来把两次取数的返回顺序倒过来。 */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let settle: ((value: T) => void) | null = null
  const promise = new Promise<T>((done) => {
    settle = done
  })
  return { promise, resolve: (value) => settle?.(value) }
}

beforeEach(() => {
  vi.spyOn(hvac, 'listRawSamples').mockResolvedValue(page([]))
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useEpisodeCurve', () => {
  it('只取起始前后那一段，且按台取——事件是房间级的，曲线是某一台的', async () => {
    const curve = useEpisodeCurve()
    await curve.load('a1', episode(), CATALOG)
    const [acUnitId, query] = vi.mocked(hvac.listRawSamples).mock.calls[0] ?? []
    expect(acUnitId).toBe('a1')
    expect(query?.from).toBe('2026-08-12T01:50:00.000Z')
    expect(query?.to).toBe('2026-08-12T02:35:00.000Z')
  })

  it('只画达标看的那两个量，名字与量纲取自目录', async () => {
    const curve = useEpisodeCurve()
    await curve.load('a1', episode(), CATALOG)
    expect(curve.series.value.map((item) => item.key)).toEqual([
      'workshop_temp_avg',
      'workshop_humidity_avg',
    ])
    expect(curve.series.value[0]?.name).toBe('车间温度')
    expect(curve.series.value[1]?.unit).toBe('%')
  })

  it('温湿度分到不同的 Y 轴', async () => {
    const curve = useEpisodeCurve()
    await curve.load('a1', episode(), CATALOG)
    expect(curve.series.value[0]?.axis).toBe('temperature')
    expect(curve.series.value[1]?.axis).toBe('humidity')
  })

  it('null 保持成 null——断档才画成缺口，连起来就成了我们自己编的曲线', async () => {
    vi.mocked(hvac.listRawSamples).mockResolvedValue(
      page([sample(STAMP, 21.5), sample('2026-08-12T02:01:00.000Z', null)]),
    )
    const curve = useEpisodeCurve()
    await curve.load('a1', episode(), CATALOG)
    expect(curve.series.value[0]?.points.map(([, value]) => value)).toEqual([
      21.5,
      null,
    ])
  })

  it('目录里查不到就退回用 key 当名字，不渲染成空白', async () => {
    const curve = useEpisodeCurve()
    await curve.load('a1', episode(), [])
    expect(curve.series.value[0]?.name).toBe('workshop_temp_avg')
  })

  it('取不回来时说出原因并清空曲线，不留着上一条的线', async () => {
    vi.mocked(hvac.listRawSamples).mockRejectedValue(new Error('boom'))
    const curve = useEpisodeCurve()
    await curve.load('a1', episode(), CATALOG)
    expect(curve.error.value).toContain('请求失败')
    expect(curve.series.value).toEqual([])
  })

  it('reset 清掉曲线与错误，换一条事件时不会闪出上一条', async () => {
    vi.mocked(hvac.listRawSamples).mockRejectedValue(new Error('boom'))
    const curve = useEpisodeCurve()
    await curve.load('a1', episode(), CATALOG)
    curve.reset()
    expect(curve.error.value).toBeNull()
    expect(curve.series.value).toEqual([])
  })

  it('连点两条时慢的那次不许盖掉新曲线', async () => {
    const slow = deferred<CursorPage<RawSample>>()
    const fast = deferred<CursorPage<RawSample>>()
    vi.mocked(hvac.listRawSamples)
      .mockReturnValueOnce(slow.promise)
      .mockReturnValueOnce(fast.promise)
    const curve = useEpisodeCurve()
    void curve.load('a1', episode(), CATALOG)
    const second = curve.load('a2', episode(), CATALOG)

    fast.resolve(page([sample(STAMP, 88)]))
    await second
    slow.resolve(page([sample(STAMP, 11)]))
    await Promise.resolve()

    expect(curve.series.value[0]?.points[0]?.[1]).toBe(88)
  })
})
