/**
 * @fileoverview 锁住自动漫游归一化的四条口径：缺省值、上限夹取、逐段覆盖的
 * 「留空 = 不覆盖」，以及**悬空视点 id 一律留着不清理**。
 *
 * ⚠ 悬空 id 静默清掉的话，用户只会看到轨迹凭空少了两站、也没有任何警告——
 * 引用是否悬空由 `collectTwinConfigIssues` 报，归一化只管形状。
 */
import { describe, expect, it } from 'vitest'

import { normalizeTwinConfig } from '../src/normalize'
import {
  DEFAULT_ROAM_TOUR_IDLE_DELAY_MS,
  DEFAULT_ROAM_TOUR_PAUSE_MS,
  DEFAULT_ROAM_TOUR_SEGMENT_MS,
  MAX_ROAM_TOUR_IDLE_DELAY_MS,
  MAX_ROAM_TOUR_PAUSE_MS,
  MAX_ROAM_TOUR_SEGMENT_MS,
  normalizeRoamTour,
} from '../src/normalizeScene'

describe('normalizeRoamTour 的缺省', () => {
  it('什么都没配时是「关着、循环、带控件」的一份空轨迹', () => {
    expect(normalizeRoamTour(undefined)).toEqual({
      enabled: false,
      autoplay: false,
      idleAutoplay: false,
      idleAutoplayDelayMs: DEFAULT_ROAM_TOUR_IDLE_DELAY_MS,
      loop: true,
      showControls: true,
      items: [],
      segmentMs: DEFAULT_ROAM_TOUR_SEGMENT_MS,
      pauseMs: DEFAULT_ROAM_TOUR_PAUSE_MS,
      segmentSettings: {},
    })
  })

  it('三个开关只认布尔真，字符串不算开', () => {
    const tour = normalizeRoamTour({
      enabled: 'yes',
      autoplay: 1,
      idleAutoplay: 'true',
    })
    expect(tour.enabled).toBe(false)
    expect(tour.autoplay).toBe(false)
    expect(tour.idleAutoplay).toBe(false)
  })

  it('循环与控件缺省开，显式给 false 才关', () => {
    expect(
      normalizeRoamTour({ loop: false, showControls: false }),
    ).toMatchObject({ loop: false, showControls: false })
  })
})

describe('normalizeRoamTour 的时长', () => {
  it('三个时长各自夹进上限', () => {
    const tour = normalizeRoamTour({
      segmentMs: 1e9,
      pauseMs: 1e9,
      idleAutoplayDelayMs: 1e12,
    })
    expect(tour.segmentMs).toBe(MAX_ROAM_TOUR_SEGMENT_MS)
    expect(tour.pauseMs).toBe(MAX_ROAM_TOUR_PAUSE_MS)
    expect(tour.idleAutoplayDelayMs).toBe(MAX_ROAM_TOUR_IDLE_DELAY_MS)
  })

  it('负数与非有限数落回 0 或缺省', () => {
    const tour = normalizeRoamTour({
      segmentMs: -1,
      pauseMs: Number.NaN,
      idleAutoplayDelayMs: Number.POSITIVE_INFINITY,
    })
    expect(tour.segmentMs).toBe(0)
    expect(tour.pauseMs).toBe(DEFAULT_ROAM_TOUR_PAUSE_MS)
    expect(tour.idleAutoplayDelayMs).toBe(DEFAULT_ROAM_TOUR_IDLE_DELAY_MS)
  })
})

describe('normalizeRoamTour 的站点清单', () => {
  // ⚠ 这条是本文件的重点：删掉一个视点，轨迹里那一项必须原样留着
  it('指向不存在视点的 id 留在清单里，不静默清掉', () => {
    const config = normalizeTwinConfig({
      cameras: [{ id: 'c1' }],
      roamTour: { items: ['c1', '没了', 'c2'] },
    })
    expect(config.roamTour.items).toEqual(['c1', '没了', 'c2'])
  })

  it('去空白、丢空串，同一个视点只留第一次', () => {
    expect(
      normalizeRoamTour({ items: [' c1 ', '', 'c1', 'c2'] }).items,
    ).toEqual(['c1', 'c2'])
  })

  it('清单不是数组时给空数组而不是抛错', () => {
    expect(normalizeRoamTour({ items: 'c1' }).items).toEqual([])
  })
})

describe('normalizeRoamTour 的逐段覆盖', () => {
  it('两项都没配的那条覆盖整个消失', () => {
    const tour = normalizeRoamTour({
      segmentSettings: { c1: {}, c2: { segmentMs: 500 } },
    })
    expect(tour.segmentSettings).toEqual({
      c2: { segmentMs: 500, pauseMs: null },
    })
  })

  it('只配一项时另一项是 null，表示这一项还用全局值', () => {
    const tour = normalizeRoamTour({
      segmentSettings: { c1: { pauseMs: 800 } },
    })
    expect(tour.segmentSettings.c1).toEqual({ segmentMs: null, pauseMs: 800 })
  })

  it('覆盖值同样夹进上限并取整', () => {
    const tour = normalizeRoamTour({
      segmentSettings: { c1: { segmentMs: 1e9, pauseMs: 12.6 } },
    })
    expect(tour.segmentSettings.c1).toEqual({
      segmentMs: MAX_ROAM_TOUR_SEGMENT_MS,
      pauseMs: 13,
    })
  })

  // ⚠ 与站点清单同一个口径：把一个视点暂时挪出轨迹，不该顺手抹掉它那段的时长
  it('键不在清单里的覆盖照样留着', () => {
    const tour = normalizeRoamTour({
      items: ['c1'],
      segmentSettings: { c9: { segmentMs: 700 } },
    })
    expect(tour.segmentSettings.c9).toEqual({ segmentMs: 700, pauseMs: null })
  })

  it('覆盖表不是对象时给空表', () => {
    expect(
      normalizeRoamTour({ segmentSettings: [1, 2] }).segmentSettings,
    ).toEqual({})
  })
})

describe('normalizeRoamTour 的幂等', () => {
  const MESSY = {
    enabled: true,
    idleAutoplayDelayMs: 1e12,
    loop: false,
    items: [' c1 ', 'c1', 'ghost'],
    segmentMs: 12.6,
    pauseMs: -5,
    segmentSettings: { c1: { segmentMs: 999.4 }, c2: {} },
  }

  it('跑两遍与跑一遍结果相同', () => {
    const once = normalizeRoamTour(MESSY)
    expect(normalizeRoamTour(once)).toEqual(once)
  })

  it('JSON 往返之后形状不变，输出里没有 undefined', () => {
    const once = normalizeRoamTour(MESSY)
    const roundTripped: unknown = JSON.parse(JSON.stringify(once))
    expect(roundTripped).toEqual(once)
  })
})
