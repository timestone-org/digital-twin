/**
 * @fileoverview 相机飞行：把切视点与聚焦从瞬移换成一段插值飞行，复用漫游的
 * 曲线（绕注视点球面插值 + 缓入缓出）。自己不持计时器，时间由宿主的渲染循环
 * 逐帧喂进来；用户接管镜头时由宿主调 `cancel`，镜头停在当前位置。
 */
import { applyRoamEasing, interpTwinPose, type TwinPose } from '@dt/twin-config'
import type * as THREE from 'three'

import { applyCameraPose, frameBoxPose, type SceneCore } from './sceneCore'

/** 一段飞行的时长。 */
export const CAMERA_FLIGHT_MS = 700

export interface CameraFlight {
  /** 从当前机位飞过去；系统偏好减少动态时直接落位。 */
  flyTo: (core: SceneCore, to: TwinPose, span: number) => void
  /** 飞到能框住包围盒的机位；空盒不动镜头。 */
  flyToBox: (core: SceneCore, box: THREE.Box3) => void
  /** 每帧推进；没在飞就是空操作。 */
  advance: (deltaMs: number) => void
  /** 停在当前位置。用户接管镜头与宿主卸载时都必须调。 */
  cancel: () => void
  isFlying: () => boolean
}

interface FlightState {
  core: SceneCore
  from: TwinPose
  to: TwinPose
  span: number
  elapsedMs: number
}

/** 系统级「减少动态」偏好：开着就不飞，直接落位。 */
function prefersInstant(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

/**
 * 相机此刻的机位、注视点与视野。
 * @param core 场景内核
 */
export function cameraPoseOf(core: SceneCore): TwinPose {
  const eye = core.camera.position
  const target = core.controls.target
  return {
    position: [eye.x, eye.y, eye.z],
    target: [target.x, target.y, target.z],
    fov: core.camera.fov,
  }
}

/** 落位并立刻生效；与瞬移路径同款的那一次 `controls.update()`。 */
function land(core: SceneCore, pose: TwinPose, span: number): void {
  applyCameraPose(core, pose, span)
  core.controls.update()
}

/**
 * 造一段可复用的飞行；一个场景一份，新的一段起飞会顶掉半路的上一段。
 */
export function createCameraFlight(): CameraFlight {
  let state: FlightState | null = null

  function flyTo(core: SceneCore, to: TwinPose, span: number): void {
    if (prefersInstant()) {
      state = null
      land(core, to, span)
      return
    }
    // 半路换目标就从当前位置重新起飞，衔接处不跳变
    state = { core, from: cameraPoseOf(core), to, span, elapsedMs: 0 }
  }

  return {
    flyTo,

    flyToBox: (core, box) => {
      const framed = frameBoxPose(core.camera, box)
      if (framed === null) return
      flyTo(core, framed.pose, framed.span)
    },

    advance: (deltaMs) => {
      if (state === null) return
      state.elapsedMs += deltaMs
      if (state.elapsedMs >= CAMERA_FLIGHT_MS) {
        land(state.core, state.to, state.span)
        state = null
        return
      }
      const progress = applyRoamEasing(state.elapsedMs / CAMERA_FLIGHT_MS)
      // 逐帧落位姿不调 controls.update()：渲染循环每帧已经调过一次
      applyCameraPose(
        state.core,
        interpTwinPose(state.from, state.to, progress),
        state.span,
      )
    },

    cancel: () => {
      state = null
    },

    isFlying: () => state !== null,
  }
}
