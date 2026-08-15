/**
 * @fileoverview 锁住漫游时间线的推进规则：分段与停顿怎么摊、循环与非循环怎么收尾、
 * 逐段覆盖从哪一段取，以及**一步再大也只推进一个上限**。
 *
 * ⚠ 最后一条是切走标签页再回来那一帧的唯一防线：不夹的话一帧就能把整条轨迹走完，
 * 用户切回来看到的是镜头已经停在终点，而全程没有任何报错。
 */
import { describe, expect, it } from 'vitest'

import { normalizeTwinConfig } from '../src/normalize'
import {
  MAX_ROAM_STEP_MS,
  RoamTimeline,
  buildRoamSegments,
  roamTourStops,
} from '../src/roamTimeline'
import type { TwinCamera, TwinConfig, TwinRoamTour } from '../src/types'

/** 三个视点摆在一条直线上，插值结果好断言。 */
function twin(roamTour: Record<string, unknown>): TwinConfig {
  return normalizeTwinConfig({
    cameras: [
      {
        id: 'c1',
        name: '一号',
        position: [10, 0, 0],
        target: [0, 0, 0],
        fov: 40,
      },
      {
        id: 'c2',
        name: '二号',
        position: [0, 0, 10],
        target: [0, 0, 0],
        fov: 40,
      },
      {
        id: 'c3',
        name: '三号',
        position: [-10, 0, 0],
        target: [0, 0, 0],
        fov: 60,
      },
    ],
    roamTour,
  })
}

function segmentsOf(config: TwinConfig): ReturnType<typeof buildRoamSegments> {
  return buildRoamSegments(config.cameras, config.roamTour)
}

function timelineOf(config: TwinConfig): RoamTimeline {
  return new RoamTimeline(segmentsOf(config), config.roamTour.loop)
}

const LINE = twin({ items: ['c1', 'c2', 'c3'], segmentMs: 1000, pauseMs: 500 })

describe('roamTourStops', () => {
  it('按清单顺序取视点，指向已删视点的那一项跳过', () => {
    const config = twin({ items: ['c3', '没了', 'c1'] })
    expect(
      roamTourStops(config.cameras, config.roamTour).map((item) => item.id),
    ).toEqual(['c3', 'c1'])
  })
})

describe('buildRoamSegments', () => {
  it('循环时补上「末站飞回首站」那一段', () => {
    const segments = segmentsOf(twin({ items: ['c1', 'c2', 'c3'], loop: true }))
    expect(segments.map((item) => `${item.fromId}-${item.toId}`)).toEqual([
      'c1-c2',
      'c2-c3',
      'c3-c1',
    ])
  })

  it('不循环时只有站点之间那几段', () => {
    const segments = segmentsOf(
      twin({ items: ['c1', 'c2', 'c3'], loop: false }),
    )
    expect(segments).toHaveLength(2)
  })

  // ⚠ 一段都摊不出来不是「播 0 秒」，是这条轨迹根本不成立
  it('可用站点不足两个时一段都不给', () => {
    expect(segmentsOf(twin({ items: ['c1'] }))).toEqual([])
    expect(segmentsOf(twin({ items: ['c1', '没了'] }))).toEqual([])
  })

  it('逐段覆盖按**起始**视点取，没配的段仍用全局值', () => {
    const segments = segmentsOf(
      twin({
        items: ['c1', 'c2', 'c3'],
        loop: false,
        segmentMs: 1000,
        pauseMs: 200,
        segmentSettings: { c1: { segmentMs: 300, pauseMs: 50 } },
      }),
    )
    expect(segments[0]).toMatchObject({ flyMs: 300, holdMs: 50 })
    expect(segments[1]).toMatchObject({ flyMs: 1000, holdMs: 200 })
  })
})

describe('RoamTimeline 的推进', () => {
  it('没开播时推进什么都不给', () => {
    expect(timelineOf(LINE).advance(100)).toBeNull()
  })

  it('开播第一帧就落在起点位姿上', () => {
    const timeline = timelineOf(LINE)
    timeline.play()
    expect(timeline.advance(0)?.position).toEqual([10, 0, 0])
  })

  it('段内推进走的是插值位姿，不是端点', () => {
    const timeline = timelineOf(LINE)
    timeline.play()
    const pose = timeline.advance(MAX_ROAM_STEP_MS)
    expect(pose?.position).not.toEqual([10, 0, 0])
    expect(pose?.position).not.toEqual([0, 0, 10])
  })

  it('飞完一段先进停顿：停顿里位姿钉在落点上', () => {
    const timeline = timelineOf(LINE)
    timeline.play()
    for (let step = 0; step < 10; step += 1) timeline.advance(MAX_ROAM_STEP_MS)
    expect(timeline.currentPhase).toBe('holding')
    expect(timeline.advance(MAX_ROAM_STEP_MS)?.position).toEqual([0, 0, 10])
  })

  it('停顿走完接着飞下一段', () => {
    const timeline = timelineOf(LINE)
    timeline.play()
    for (let step = 0; step < 16; step += 1) timeline.advance(MAX_ROAM_STEP_MS)
    expect(timeline.segmentIndex).toBe(1)
    expect(timeline.currentPhase).toBe('flying')
  })

  // ⚠ 这条守的是「切走标签页再回来」：一步再大也只走一个上限
  it('喂一个巨大的 dt 只推进一个上限，不会一帧飞完整条轨迹', () => {
    const timeline = timelineOf(LINE)
    timeline.play()
    timeline.advance(60_000)
    expect(timeline.segmentIndex).toBe(0)
    expect(timeline.currentPhase).toBe('flying')
    expect(timeline.isPlaying).toBe(true)
  })

  it('非有限的 dt 按 0 算，不把内部时钟污染成 NaN', () => {
    const timeline = timelineOf(LINE)
    timeline.play()
    timeline.advance(Number.NaN)
    expect(timeline.advance(0)?.position).toEqual([10, 0, 0])
  })
})

describe('RoamTimeline 的循环与收尾', () => {
  it('循环轨迹走完最后一段回到第 0 段接着飞', () => {
    const timeline = timelineOf(
      twin({ items: ['c1', 'c2'], loop: true, segmentMs: 100, pauseMs: 0 }),
    )
    timeline.play()
    const visited: number[] = []
    for (let step = 0; step < 3; step += 1) {
      timeline.advance(MAX_ROAM_STEP_MS)
      visited.push(timeline.segmentIndex)
    }
    expect(visited).toEqual([1, 0, 1])
    expect(timeline.isPlaying).toBe(true)
  })

  it('非循环轨迹走完停在终点位姿上，不弹回起点', () => {
    const timeline = timelineOf(
      twin({ items: ['c1', 'c2'], loop: false, segmentMs: 100, pauseMs: 0 }),
    )
    timeline.play()
    let last = timeline.advance(MAX_ROAM_STEP_MS)
    while (timeline.isPlaying) last = timeline.advance(MAX_ROAM_STEP_MS)
    expect(last?.position).toEqual([0, 0, 10])
    expect(timeline.currentPhase).toBe('idle')
  })

  it('走完之后再 play 是从头再来', () => {
    const timeline = timelineOf(
      twin({ items: ['c1', 'c2'], loop: false, segmentMs: 100, pauseMs: 0 }),
    )
    timeline.play()
    while (timeline.isPlaying) timeline.advance(MAX_ROAM_STEP_MS)
    timeline.play()
    expect(timeline.segmentIndex).toBe(0)
    expect(timeline.advance(0)?.position).toEqual([10, 0, 0])
  })

  // ⚠ 时长全配成 0 是合法配置：没有循环上限的话这一步就是死循环，页面整个卡死
  it('时长全是 0 的轨迹推进一步也能返回，不死循环', () => {
    const timeline = timelineOf(
      twin({ items: ['c1', 'c2', 'c3'], segmentMs: 0, pauseMs: 0 }),
    )
    timeline.play()
    expect(timeline.advance(MAX_ROAM_STEP_MS)).not.toBeNull()
  })
})

describe('RoamTimeline 的手动控制', () => {
  it('暂停之后推进不给位姿，恢复后从原处接着走', () => {
    const timeline = timelineOf(LINE)
    timeline.play()
    timeline.advance(500)
    timeline.pause()
    expect(timeline.advance(MAX_ROAM_STEP_MS)).toBeNull()
    timeline.play()
    expect(timeline.segmentIndex).toBe(0)
    expect(timeline.isPlaying).toBe(true)
  })

  it('停下会回到起点，接着 play 从第一段开始', () => {
    const timeline = timelineOf(LINE)
    timeline.play()
    for (let step = 0; step < 16; step += 1) timeline.advance(MAX_ROAM_STEP_MS)
    timeline.stop()
    expect(timeline.isPlaying).toBe(false)
    expect(timeline.segmentIndex).toBe(0)
  })

  it('下一段直接落到下一站的机位上', () => {
    const timeline = timelineOf(LINE)
    timeline.next()
    expect(timeline.segmentIndex).toBe(1)
    expect(timeline.pose()?.position).toEqual([0, 0, 10])
  })

  it('上一段在第 0 段时绕回最后一段', () => {
    const timeline = timelineOf(LINE)
    timeline.prev()
    expect(timeline.segmentIndex).toBe(segmentsOf(LINE).length - 1)
  })

  it('轨迹不成立时开播与推进都是空操作', () => {
    const timeline = timelineOf(twin({ items: ['c1'] }))
    timeline.play()
    expect(timeline.isEmpty).toBe(true)
    expect(timeline.isPlaying).toBe(false)
    expect(timeline.advance(MAX_ROAM_STEP_MS)).toBeNull()
    expect(timeline.pose()).toBeNull()
  })
})

describe('段时长为 0 的那一段', () => {
  it('飞行时长 0 时位姿直接落在终点，不产生除零', () => {
    const config = twin({
      items: ['c1', 'c2'],
      loop: false,
      segmentMs: 0,
      pauseMs: 1000,
    })
    const timeline = timelineOf(config)
    timeline.play()
    expect(timeline.advance(0)?.position).toEqual([0, 0, 10])
  })
})

describe('逐段覆盖驱动的时长', () => {
  const CAMERAS: readonly TwinCamera[] = LINE.cameras

  it('覆盖成短段之后，同样的推进量能多跨一段', () => {
    const tour: TwinRoamTour = {
      ...LINE.roamTour,
      loop: false,
      segmentSettings: { c1: { segmentMs: 50, pauseMs: 0 } },
    }
    const timeline = new RoamTimeline(buildRoamSegments(CAMERAS, tour), false)
    timeline.play()
    timeline.advance(MAX_ROAM_STEP_MS)
    expect(timeline.segmentIndex).toBe(1)
  })
})
