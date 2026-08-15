/**
 * @fileoverview 相机位姿与两个位姿之间的插值曲线：绕注视点做球面插值，再套一层
 * 缓入缓出。纯数学，无 Vue 无 three——运行态漫游与编辑器预览共用这一条曲线。
 */
import { clamp } from './sanitize'
import type { Vec3 } from './types'

/** 相机位姿：机位 + 注视点 + 视野（度）。 */
export interface TwinPose {
  position: Vec3
  target: Vec3
  fov: number
}

/** 夹角小于它就退回线性插值，避免除以 sin(0) */
const MIN_SLERP_ANGLE = 1e-4
/** 机位与注视点重合的判定：半径小于它就没有方向可言 */
const MIN_ORBIT_RADIUS = 1e-6
/** 三次缓动的分段点 */
const EASE_MID = 0.5

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t
}

function lerpVec3(from: Vec3, to: Vec3, t: number): Vec3 {
  return [
    lerp(from[0], to[0], t),
    lerp(from[1], to[1], t),
    lerp(from[2], to[2], t),
  ]
}

function subVec3(left: Vec3, right: Vec3): Vec3 {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]]
}

function lengthOf(value: Vec3): number {
  return Math.hypot(value[0], value[1], value[2])
}

function scaledVec3(value: Vec3, factor: number): Vec3 {
  return [value[0] * factor, value[1] * factor, value[2] * factor]
}

function normalized(value: Vec3): Vec3 {
  const length = lengthOf(value)
  return length < MIN_ORBIT_RADIUS ? value : scaledVec3(value, 1 / length)
}

/** 单位向量的球面插值；夹角过小时退回线性，否则除数趋零后方向会整个翻掉。 */
function slerpDirection(from: Vec3, to: Vec3, t: number): Vec3 {
  const dot = clamp(from[0] * to[0] + from[1] * to[1] + from[2] * to[2], -1, 1)
  const angle = Math.acos(dot)
  if (angle < MIN_SLERP_ANGLE) return normalized(lerpVec3(from, to, t))
  const sine = Math.sin(angle)
  const wFrom = Math.sin((1 - t) * angle) / sine
  const wTo = Math.sin(t * angle) / sine
  return [
    from[0] * wFrom + to[0] * wTo,
    from[1] * wFrom + to[1] * wTo,
    from[2] * wFrom + to[2] * wTo,
  ]
}

/**
 * 缓入缓出（三次）：两端速度为零，镜头起步与停车都不生硬。
 * ⚠ 非有限的进度按 0 算：`clamp` 拦不住 NaN，而一个 NaN 会顺着插值一路传成
 * NaN 的机位，表现是模型忽然整个不见了，控制台一声不吭。
 * @param t 段内进度，超出 [0,1] 的一律夹回
 */
export function applyRoamEasing(t: number): number {
  const x = clamp(Number.isFinite(t) ? t : 0, 0, 1)
  return x < EASE_MID ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2
}

/**
 * 绕注视点插出来的机位。
 * ⚠ 走球面而不是直线：直线会从模型内部穿过去，看起来像镜头一头扎进了设备里
 * 再钻出来。任一端半径为 0（机位与注视点重合）时没有方向可插，退回直线。
 */
function orbitPosition(
  from: TwinPose,
  to: TwinPose,
  t: number,
  target: Vec3,
): Vec3 {
  const fromOffset = subVec3(from.position, from.target)
  const toOffset = subVec3(to.position, to.target)
  const fromRadius = lengthOf(fromOffset)
  const toRadius = lengthOf(toOffset)
  if (fromRadius < MIN_ORBIT_RADIUS || toRadius < MIN_ORBIT_RADIUS) {
    return lerpVec3(from.position, to.position, t)
  }
  const direction = slerpDirection(
    normalized(fromOffset),
    normalized(toOffset),
    t,
  )
  const radius = lerp(fromRadius, toRadius, t)
  return [
    target[0] + direction[0] * radius,
    target[1] + direction[1] * radius,
    target[2] + direction[2] * radius,
  ]
}

/**
 * 两个机位之间的位姿插值。
 * @param from 起点位姿
 * @param to 终点位姿
 * @param t 段内进度 [0,1]，缓动由调用方先套好
 */
export function interpTwinPose(
  from: TwinPose,
  to: TwinPose,
  t: number,
): TwinPose {
  const target = lerpVec3(from.target, to.target, t)
  return {
    position: orbitPosition(from, to, t, target),
    target,
    fov: lerp(from.fov, to.fov, t),
  }
}
