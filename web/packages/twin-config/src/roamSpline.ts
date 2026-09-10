/** @fileoverview 按飞行时长拟合球坐标 Hermite 曲线，供整条漫游时间线采样。 */
import type { TwinPose } from './roamPose'
import type { Vec3 } from './types'

export interface RoamSplineSegment {
  from: TwinPose
  to: TwinPose
  /** 飞行时长 ms。 */
  flyMs: number
  /** 到站后的停留时长 ms。 */
  holdMs: number
}

type Cubic = readonly [number, number, number, number]
type CubicVec3 = readonly [Cubic, Cubic, Cubic]
type Durations = readonly [number, number, number]

interface OrbitPose {
  orbit: Vec3
  target: Vec3
  fov: number
}

interface PoseCurve {
  orbit: CubicVec3
  target: CubicVec3
  fov: Cubic
}

function orbitOf(pose: TwinPose): OrbitPose {
  const x = pose.position[0] - pose.target[0]
  const y = pose.position[1] - pose.target[1]
  const z = pose.position[2] - pose.target[2]
  return {
    orbit: [
      Math.atan2(z, x),
      Math.atan2(y, Math.hypot(x, z)),
      Math.hypot(x, y, z),
    ],
    target: pose.target,
    fov: pose.fov,
  }
}

function angleDelta(from: number, to: number): number {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from))
}

/** 同向割线的调和平均限制过冲，拐点或停留处的切线归零。 */
function velocity(
  before: number,
  after: number,
  leftMs: number,
  rightMs: number,
): number {
  if (leftMs <= 0 || rightMs <= 0 || before * after <= 0) return 0
  const left = before / leftMs
  const right = after / rightMs
  return 2 / (1 / left + 1 / right)
}

function centeredVelocity(
  before: number,
  after: number,
  leftMs: number,
  rightMs: number,
): number {
  if (leftMs <= 0 || rightMs <= 0) return 0
  return (before + after) / (leftMs + rightMs)
}

function cubicOf(
  values: readonly [number, number, number, number],
  durations: Durations,
  tangent = velocity,
): Cubic {
  const [previous, from, to, next] = values
  const [leftMs, flyMs, rightMs] = durations
  const delta = to - from
  const start = tangent(from - previous, delta, leftMs, flyMs) * flyMs
  const end = tangent(delta, next - to, flyMs, rightMs) * flyMs
  return [from, start, 3 * delta - 2 * start - end, -2 * delta + start + end]
}

function sameVector(left: Vec3, right: Vec3): boolean {
  return left[0] === right[0] && left[1] === right[1] && left[2] === right[2]
}

function vectorCurve(
  values: readonly [Vec3, Vec3, Vec3, Vec3],
  durations: Durations,
  tangent = velocity,
): CubicVec3 {
  const [previous, from, to, next] = values
  const spans: Durations = [
    sameVector(previous, from) ? 0 : durations[0],
    sameVector(from, to) ? 0 : durations[1],
    sameVector(to, next) ? 0 : durations[2],
  ]
  return [
    cubicOf([previous[0], from[0], to[0], next[0]], spans, tangent),
    cubicOf([previous[1], from[1], to[1], next[1]], spans, tangent),
    cubicOf([previous[2], from[2], to[2], next[2]], spans, tangent),
  ]
}

function curveOf(
  segment: RoamSplineSegment,
  previous?: RoamSplineSegment,
  next?: RoamSplineSegment,
): PoseCurve {
  const from = orbitOf(segment.from)
  const to = orbitOf(segment.to)
  const before = orbitOf(previous?.from ?? segment.from)
  const after = orbitOf(next?.to ?? segment.to)
  // ⚠ 方位角必须逐段展开，否则跨 ±π 时会绕远路，循环接缝也会反转。
  before.orbit[0] = from.orbit[0] - angleDelta(before.orbit[0], from.orbit[0])
  to.orbit[0] = from.orbit[0] + angleDelta(from.orbit[0], to.orbit[0])
  after.orbit[0] = to.orbit[0] + angleDelta(to.orbit[0], after.orbit[0])
  const durations: Durations = [
    previous?.holdMs === 0 ? previous.flyMs : 0,
    segment.flyMs,
    segment.holdMs === 0 ? (next?.flyMs ?? 0) : 0,
  ]
  return {
    orbit: vectorCurve(
      [before.orbit, from.orbit, to.orbit, after.orbit],
      durations,
    ),
    target: vectorCurve(
      [before.target, from.target, to.target, after.target],
      durations,
      centeredVelocity,
    ),
    fov: cubicOf([before.fov, from.fov, to.fov, after.fov], durations),
  }
}

function sample(cubic: Cubic, t: number): number {
  return cubic[0] + t * (cubic[1] + t * (cubic[2] + t * cubic[3]))
}

function sampleVector(curve: CubicVec3, t: number): Vec3 {
  return [sample(curve[0], t), sample(curve[1], t), sample(curve[2], t)]
}

/** 预计算段系数；每帧只采样当前段，不重新拟合整条路径。 */
export class RoamSpline {
  private readonly curves: readonly PoseCurve[]

  constructor(segments: readonly RoamSplineSegment[], loop: boolean) {
    this.curves = segments.map((segment, index) =>
      curveOf(
        segment,
        segments[index - 1] ??
          (loop ? segments[segments.length - 1] : undefined),
        segments[index + 1] ?? (loop ? segments[0] : undefined),
      ),
    )
  }

  pose(index: number, progress: number, segment: RoamSplineSegment): TwinPose {
    const curve = this.curves[index]
    if (curve === undefined || progress <= 0) return segment.from
    if (progress >= 1) return segment.to
    const [yaw, elevation, radius] = sampleVector(curve.orbit, progress)
    const target = sampleVector(curve.target, progress)
    const horizontal = radius * Math.cos(elevation)
    return {
      position: [
        target[0] + horizontal * Math.cos(yaw),
        target[1] + radius * Math.sin(elevation),
        target[2] + horizontal * Math.sin(yaw),
      ],
      target,
      fov: sample(curve.fov, progress),
    }
  }
}
