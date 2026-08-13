/**
 * @fileoverview 实时读数换算的单测：缺测必须**省略字段**而不是发 null。
 */
import { describe, expect, it } from 'vitest'

import {
  LIVE_STALE_MINUTES,
  draftFromUnits,
  hasAnyReading,
  isDraftEdited,
  isStaleReading,
  liveTestNotices,
  stalenessMinutes,
  toPredictReadings,
  toRecommendReadings,
} from '@/features/hvac/liveTest'
import { liveUnit } from '@/testing/modelFixtures'

const BLANK = {
  workshop_temp_avg: null,
  workshop_humidity_avg: null,
  fresh_air_temp: null,
  fresh_air_humidity: null,
  chilled_water_supply_temp: null,
}

function notices(over: Partial<Parameters<typeof liveTestNotices>[0]> = {}) {
  return liveTestNotices({
    isRetraining: false,
    isLastTrainingFailed: false,
    isModelRetrained: false,
    resultEdited: false,
    resultBlind: false,
    staleCount: 0,
    staleMinutes: 0,
    missingCount: 0,
    allMissing: false,
    ...over,
  })
}

describe('读数 → 推荐入参', () => {
  it('⚠ null 的字段整个省略：发 null 与「没这个字段」不是一回事', () => {
    const out = toPredictReadings({ ...BLANK, workshop_temp_avg: 24.1 })
    expect(out).toEqual({ workshop_temp_avg: 24.1 })
    expect('fresh_air_temp' in out).toBe(false)
  })

  it('0 是真实读数，照发不误', () => {
    expect(toPredictReadings({ ...BLANK, fresh_air_temp: 0 })).toEqual({
      fresh_air_temp: 0,
    })
  })

  it('⚠ 五项全缺的那台整台不进字典', () => {
    const draft = { K11: { ...BLANK }, K12: { ...BLANK, fresh_air_temp: 30 } }
    expect(Object.keys(toRecommendReadings(draft))).toEqual(['K12'])
  })

  it('hasAnyReading 只看有没有一项非空', () => {
    expect(hasAnyReading(BLANK)).toBe(false)
    expect(hasAnyReading({ ...BLANK, fresh_air_humidity: 0 })).toBe(true)
  })
})

describe('草稿', () => {
  it('从实时读数拷一份，未改动时不算「已手动调整」', () => {
    const units = [liveUnit()]
    const draft = draftFromUnits(units)
    expect(draft['K11']?.workshop_temp_avg).toBe(24.1)
    expect(isDraftEdited(draft, units)).toBe(false)
  })

  it('改一个字段（含清空成缺测）就算改过', () => {
    const units = [liveUnit()]
    const draft = draftFromUnits(units)
    const edited = {
      K11: { ...BLANK, ...draft['K11'], workshop_temp_avg: null },
    }
    expect(isDraftEdited(edited, units)).toBe(true)
  })
})

describe('陈旧判定', () => {
  it('sampled_at 为 null 时算不出旧了多久，也不算陈旧', () => {
    expect(stalenessMinutes('2026-08-12T03:00:00.000Z', null)).toBeNull()
    expect(isStaleReading('2026-08-12T03:00:00.000Z', null)).toBe(false)
  })

  it('超过阈值才算陈旧；正好等于阈值不算', () => {
    const asOf = '2026-08-12T03:00:00.000Z'
    expect(stalenessMinutes(asOf, '2026-08-12T02:58:00.000Z')).toBe(2)
    expect(isStaleReading(asOf, '2026-08-12T02:58:00.000Z')).toBe(false)
    expect(isStaleReading(asOf, '2026-08-12T02:55:00.000Z')).toBe(false)
    expect(isStaleReading(asOf, '2026-08-12T02:50:00.000Z')).toBe(true)
    expect(LIVE_STALE_MINUTES).toBe(5)
  })
})

describe('顶部提示', () => {
  it('都太平时一条都不出', () => {
    expect(notices()).toEqual([])
  })

  it('手动改过与完全没读数各出一条，措辞不含糊', () => {
    const found = notices({ resultEdited: true, resultBlind: true })
    expect(found.map((item) => item.id)).toEqual(['edited', 'blind'])
    expect(found[0]?.text).toContain('不是当前实时工况')
    expect(found[0]?.intent).toBe('warning')
  })

  it('陈旧说清几台与多旧', () => {
    const found = notices({ staleCount: 2, staleMinutes: 17 })
    expect(found[0]?.text).toBe(
      '有 2 台的最新读数已经是 17 分钟前的了，结果可能反映不了当下。',
    )
  })

  it('⚠ 全都缺数时不出「部分缺数」——那句话由 W1 那条说', () => {
    expect(notices({ missingCount: 3, allMissing: true })).toEqual([])
    expect(notices({ missingCount: 1 }).map((item) => item.id)).toEqual([
      'missing',
    ])
  })

  it('训练中与上次失败都说清用的是哪一份工件', () => {
    const found = notices({ isRetraining: true, isLastTrainingFailed: true })
    expect(found.map((item) => item.id)).toEqual(['retraining', 'last-failed'])
  })

  it('开着的时候重训完了要提醒，但不自动重算', () => {
    expect(notices({ isModelRetrained: true })[0]?.text).toContain(
      '重新取数并推荐',
    )
  })
})
