/**
 * @fileoverview 锁住趋势图的时间范围口径：预设档按当前时刻往回算，自定义档
 * 的两处本地错必须挡在发请求之前。
 * ⚠ 时钟由调用方注入：不注入就没法钉住「最近 24 小时」到底是哪一段。
 */
import { describe, expect, it } from 'vitest'

import {
  TREND_RANGE_CUSTOM,
  TREND_RANGE_DEFAULT,
  defaultTrendRange,
  resolveTrendRange,
  toIsoWindow,
} from '@/features/trend/trendRange'

const NOW = Date.parse('2026-08-24T12:00:00.000Z')

describe('时间范围', () => {
  it('默认档是最近 24 小时，且自定义两端留空', () => {
    expect(defaultTrendRange()).toEqual({
      preset: TREND_RANGE_DEFAULT,
      from: '',
      to: '',
    })
  })

  it('预设档从当前时刻往回算', () => {
    const { window } = resolveTrendRange(
      { preset: '6h', from: '', to: '' },
      NOW,
    )
    expect(window).toEqual({ fromMs: NOW - 6 * 3_600_000, toMs: NOW })
  })

  it('不认识的档回落 24 小时，而不是给一个空窗口', () => {
    const { window } = resolveTrendRange(
      { preset: 'forever', from: '', to: '' },
      NOW,
    )
    expect(window?.fromMs).toBe(NOW - 24 * 3_600_000)
  })

  it('自定义档缺一端时说清缺什么', () => {
    const { window, problem } = resolveTrendRange(
      { preset: TREND_RANGE_CUSTOM, from: '2026-08-01T00:00:00.000Z', to: '' },
      NOW,
    )
    expect(window).toBe(null)
    expect(problem).toContain('开始与结束')
  })

  it('自定义档倒置时挡在发请求之前', () => {
    const { window, problem } = resolveTrendRange(
      {
        preset: TREND_RANGE_CUSTOM,
        from: '2026-08-02T00:00:00.000Z',
        to: '2026-08-01T00:00:00.000Z',
      },
      NOW,
    )
    expect(window).toBe(null)
    expect(problem).toContain('早于')
  })

  it('自定义档两端合法时给出这一段', () => {
    const { window, problem } = resolveTrendRange(
      {
        preset: TREND_RANGE_CUSTOM,
        from: '2026-08-01T00:00:00.000Z',
        to: '2026-08-02T00:00:00.000Z',
      },
      NOW,
    )
    expect(problem).toBe(null)
    expect(toIsoWindow(window ?? { fromMs: 0, toMs: 0 })).toEqual({
      since: '2026-08-01T00:00:00.000Z',
      until: '2026-08-02T00:00:00.000Z',
    })
  })

  it('窗口两端换成 UTC RFC3339 才发出去', () => {
    expect(toIsoWindow({ fromMs: NOW, toMs: NOW + 1000 })).toEqual({
      since: '2026-08-24T12:00:00.000Z',
      until: '2026-08-24T12:00:01.000Z',
    })
  })
})
