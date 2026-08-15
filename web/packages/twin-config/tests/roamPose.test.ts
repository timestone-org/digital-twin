/**
 * @fileoverview 锁住漫游插值的两条曲线口径：缓动两端速度为零，机位绕注视点走
 * 球面而不是直线。
 *
 * ⚠ 直线插值会让镜头从模型内部穿过去——画面上是「一头扎进设备里再钻出来」，
 * 而没有任何一处会报错。
 */
import { describe, expect, it } from 'vitest'

import { applyRoamEasing, interpTwinPose, type TwinPose } from '../src/roamPose'

function poseAt(position: [number, number, number], fov = 40): TwinPose {
  return { position, target: [0, 0, 0], fov }
}

const LEFT = poseAt([10, 0, 0])
const FRONT = poseAt([0, 0, 10], 60)

describe('applyRoamEasing', () => {
  it('两个端点原样穿过', () => {
    expect(applyRoamEasing(0)).toBe(0)
    expect(applyRoamEasing(1)).toBe(1)
  })

  it('中点仍是中点，两头慢中间快', () => {
    expect(applyRoamEasing(0.5)).toBeCloseTo(0.5, 6)
    expect(applyRoamEasing(0.1)).toBeLessThan(0.1)
    expect(applyRoamEasing(0.9)).toBeGreaterThan(0.9)
  })

  it('超出 [0,1] 的进度夹回端点', () => {
    expect(applyRoamEasing(-5)).toBe(0)
    expect(applyRoamEasing(9)).toBe(1)
    expect(applyRoamEasing(Number.NaN)).toBe(0)
  })
})

describe('interpTwinPose', () => {
  it('两端各自还原成起点与终点', () => {
    expect(interpTwinPose(LEFT, FRONT, 0).position).toEqual([10, 0, 0])
    expect(interpTwinPose(LEFT, FRONT, 1).position[2]).toBeCloseTo(10, 6)
  })

  it('fov 线性插值', () => {
    expect(interpTwinPose(LEFT, FRONT, 0.5).fov).toBeCloseTo(50, 6)
  })

  // ⚠ 走球面：半程时到注视点的距离仍是半径，直线插值会掉到 7.07
  it('半程时机位仍在球面上，而不是两点连线的中点', () => {
    const pose = interpTwinPose(LEFT, FRONT, 0.5)
    const radius = Math.hypot(...pose.position)
    expect(radius).toBeCloseTo(10, 6)
  })

  it('注视点跟着一起插值', () => {
    const moved: TwinPose = {
      position: [0, 0, 10],
      target: [2, 0, 0],
      fov: 40,
    }
    expect(interpTwinPose(LEFT, moved, 0.5).target[0]).toBeCloseTo(1, 6)
  })

  it('机位与注视点重合的那一端退回直线，不产生 NaN', () => {
    const degenerate = poseAt([0, 0, 0])
    const pose = interpTwinPose(degenerate, FRONT, 0.5)
    expect(pose.position.every((axis) => Number.isFinite(axis))).toBe(true)
    expect(pose.position).toEqual([0, 0, 5])
  })

  it('两端方向几乎重合时也不除零', () => {
    const almost = poseAt([10, 0, 1e-9])
    const pose = interpTwinPose(LEFT, almost, 0.5)
    expect(pose.position.every((axis) => Number.isFinite(axis))).toBe(true)
  })
})
