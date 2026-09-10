/** @fileoverview 漫游经过视点和循环接缝时的速度连续性。 */
import { describe, expect, it } from 'vitest'

import { normalizeTwinConfig } from '../src/normalize'
import { buildRoamSegments, RoamTimeline } from '../src/roamTimeline'
import type { TwinPose } from '../src/roamPose'
import type { Vec3 } from '../src/types'

function timeline(
  loop = false,
  pauseMs = 0,
  settings: Record<string, unknown> = {},
): RoamTimeline {
  const config = normalizeTwinConfig({
    cameras: [0, 1, 2, 3].map((index) => ({
      id: `c${index}`,
      name: `视点${index}`,
      position: [
        10 * Math.cos((index * Math.PI) / 2),
        0,
        10 * Math.sin((index * Math.PI) / 2),
      ],
      target: [0, 0, 0],
      fov: 40,
    })),
    roamTour: {
      items: ['c0', 'c1', 'c2', 'c3'],
      loop,
      pauseMs,
      segmentMs: 1000,
      ...settings,
    },
  })
  return new RoamTimeline(
    buildRoamSegments(config.cameras, config.roamTour),
    loop,
  )
}

function poseAt(player: RoamTimeline, elapsedMs: number): TwinPose {
  player.play()
  for (let left = elapsedMs; left > 0; left -= 100) {
    player.advance(Math.min(left, 100))
  }
  const pose = player.pose()
  if (pose === null) throw new Error('缺少漫游位姿')
  return pose
}

function positionAt(player: RoamTimeline, elapsedMs: number): Vec3 {
  return poseAt(player, elapsedMs).position
}

function difference(left: Vec3, right: Vec3): Vec3 {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]]
}

describe('连续曲线漫游', () => {
  it('无停留的中间视点保持非零速度', () => {
    const before = positionAt(timeline(), 999)
    const at = positionAt(timeline(), 1000)
    const after = positionAt(timeline(), 1001)
    expect(Math.hypot(...difference(before, at))).toBeGreaterThan(0.005)
    expect(Math.hypot(...difference(after, at))).toBeGreaterThan(0.005)
  })
})

describe('曲线接缝与停留', () => {
  it.each([1000, 2000, 4000])('循环轨迹 %i ms 处的速度和方向连续', (time) => {
    const before = positionAt(timeline(true), time - 1)
    const at = positionAt(timeline(true), time)
    const after = positionAt(timeline(true), time + 1)
    const incoming = difference(at, before)
    const outgoing = difference(after, at)
    expect(Math.hypot(...incoming)).toBeGreaterThan(0.01)
    expect(Math.hypot(...difference(incoming, outgoing))).toBeLessThan(0.0001)
  })

  it('逐段时长不同仍按实际时间保持速度连续', () => {
    const create = () =>
      timeline(false, 0, {
        segmentSettings: { c1: { segmentMs: 3000, pauseMs: 0 } },
      })
    const before = positionAt(create(), 999)
    const at = positionAt(create(), 1000)
    const after = positionAt(create(), 1001)
    expect(Math.hypot(...difference(at, before))).toBeGreaterThan(0.005)
    expect(
      Math.hypot(...difference(difference(at, before), difference(after, at))),
    ).toBeLessThan(0.0001)
  })

  it('停留处平滑停车，停留结束后平滑起步', () => {
    const before = positionAt(timeline(false, 500), 999)
    const at = positionAt(timeline(false, 500), 1000)
    const held = positionAt(timeline(false, 500), 1250)
    const after = positionAt(timeline(false, 500), 1501)
    expect(held).toEqual(at)
    expect(Math.hypot(...difference(at, before))).toBeLessThan(0.0001)
    expect(Math.hypot(...difference(after, at))).toBeLessThan(0.0001)
  })

  it('非循环首尾平滑起停，环绕距离不切入球体', () => {
    const start = positionAt(timeline(), 0)
    const end = positionAt(timeline(), 3000)
    expect(
      Math.hypot(...difference(positionAt(timeline(), 1), start)),
    ).toBeLessThan(0.0001)
    expect(
      Math.hypot(...difference(positionAt(timeline(), 2999), end)),
    ).toBeLessThan(0.0001)
    for (let time = 0; time <= 3000; time += 37) {
      expect(Math.hypot(...positionAt(timeline(), time))).toBeCloseTo(10, 8)
    }
  })
})

function customTimeline(positions: Vec3[]): RoamTimeline {
  const config = normalizeTwinConfig({
    cameras: positions.map((position, index) => ({
      id: `c${index}`,
      name: `视点${index}`,
      position,
      target: [0, 0, 0],
      fov: 40,
    })),
    roamTour: {
      items: positions.map((_, index) => `c${index}`),
      segmentMs: 1000,
      pauseMs: 0,
      loop: false,
    },
  })
  return new RoamTimeline(
    buildRoamSegments(config.cameras, config.roamTour),
    false,
  )
}

describe('曲线退化边界', () => {
  it.each<{ name: string; positions: Vec3[] }>([
    {
      name: '重复视点',
      positions: [
        [10, 0, 0],
        [10, 0, 0],
        [0, 0, 10],
      ],
    },
    {
      name: '相反方向',
      positions: [
        [10, 0, 0],
        [-10, 0, 0],
      ],
    },
    {
      name: '重合的机位和注视点',
      positions: [
        [0, 0, 0],
        [0, 0, 10],
      ],
    },
    {
      name: '两极机位',
      positions: [
        [0, 10, 0],
        [0, -10, 0],
      ],
    },
  ])('$name 全程有限且准确到站', ({ positions }) => {
    const player = customTimeline(positions)
    player.play()
    for (let time = 0; time < (positions.length - 1) * 1000; time += 10) {
      const pose = player.advance(10)
      expect(pose?.position.every(Number.isFinite)).toBe(true)
    }
    expect(player.pose()?.position).toEqual(positions[positions.length - 1])
  })

  it('正对面机位的中途半径保持不变', () => {
    const middle = positionAt(
      customTimeline([
        [10, 0, 0],
        [-10, 0, 0],
      ]),
      500,
    )
    expect(Math.hypot(...middle)).toBeCloseTo(10, 8)
    expect(Math.abs(middle[2])).toBeCloseTo(10, 8)
  })
})

describe('注视点与视野曲线', () => {
  it('注视点、距离和视野在中间站连续变化且不越界', () => {
    const config = normalizeTwinConfig({
      cameras: [0, 1, 2].map((index) => ({
        id: `c${index}`,
        name: `视点${index}`,
        position: [10 + 15 * index, 2 * index, 0],
        target: [5 * index, 2 * index, 0],
        fov: 30 + 20 * index,
      })),
      roamTour: {
        items: ['c0', 'c1', 'c2'],
        segmentMs: 1000,
        pauseMs: 0,
        loop: false,
      },
    })
    const create = () =>
      new RoamTimeline(
        buildRoamSegments(config.cameras, config.roamTour),
        false,
      )
    const before = poseAt(create(), 999)
    const at = poseAt(create(), 1000)
    const after = poseAt(create(), 1001)
    expect(at.target).toEqual([5, 2, 0])
    expect(at.fov).toBe(50)
    expect(after.target[0] - at.target[0]).toBeGreaterThan(0.004)
    expect(after.fov - at.fov).toBeGreaterThan(0.019)
    expect(after.fov - at.fov).toBeCloseTo(at.fov - before.fov, 6)
    expect(
      Math.hypot(
        ...difference(
          difference(at.position, before.position),
          difference(after.position, at.position),
        ),
      ),
    ).toBeLessThan(0.0001)
    for (let time = 0; time <= 2000; time += 25) {
      const pose = poseAt(create(), time)
      expect(pose.fov).toBeGreaterThanOrEqual(30)
      expect(pose.fov).toBeLessThanOrEqual(70)
      expect(
        Math.hypot(...difference(pose.position, pose.target)),
      ).toBeGreaterThanOrEqual(10)
      expect(
        Math.hypot(...difference(pose.position, pose.target)),
      ).toBeLessThanOrEqual(30)
    }
  })
})

describe('移动注视点的转弯', () => {
  it('直角路径经过中间视点时保持连续的非零切线', () => {
    const config = normalizeTwinConfig({
      cameras: [
        [0, 0],
        [10, 0],
        [10, 10],
      ].map(([x = 0, y = 0], index) => ({
        id: `c${index}`,
        name: `视点${index}`,
        position: [x, y, 10],
        target: [x, y, 0],
        fov: 40,
      })),
      roamTour: {
        items: ['c0', 'c1', 'c2'],
        segmentMs: 1000,
        pauseMs: 0,
        loop: false,
      },
    })
    const create = () =>
      new RoamTimeline(
        buildRoamSegments(config.cameras, config.roamTour),
        false,
      )
    const before = poseAt(create(), 999)
    const at = poseAt(create(), 1000)
    const after = poseAt(create(), 1001)
    expect(at.position[0] - before.position[0]).toBeGreaterThan(0.004)
    expect(at.position[1] - before.position[1]).toBeGreaterThan(0.004)
    expect(
      Math.hypot(
        ...difference(
          difference(at.position, before.position),
          difference(after.position, at.position),
        ),
      ),
    ).toBeLessThan(0.0001)
  })
})
