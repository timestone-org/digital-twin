/**
 * @fileoverview 把「相机在哪、轨道中心在哪、这个元素在哪」换成一个按参考系
 * 取距离的函数，交给 `distanceRules` 判显隐与点击。
 *
 * ⚠ 每帧都会调，故一律复用同一个临时向量、不在循环里 new：这里是渲染热路径，
 * 每帧 new 出几十个 Vector3 的代价不会报错，只会让帧率慢慢掉下去。
 */
import type { Vec3 } from '@dt/twin-config'
import * as THREE from 'three'

import type { DistanceResolver } from './distanceRules'

/** 这一帧的相机取景状态。 */
export interface DistanceContext {
  cameraPosition: THREE.Vector3
  /** 轨道中心（OrbitControls 的 target）。 */
  orbitTarget: THREE.Vector3
  /**
   * 相机本身，信息牌摆朝向要用它的姿态。
   * ⚠ 放在这里而不是让宿主另调一次：两个视口各调一遍的话，漏掉一个就是
   * 「那个视口里的牌不跟着转」，而它既不报错也没有别的痕迹。
   */
  camera: THREE.Camera
}

const SCRATCH = new THREE.Vector3()

/** 从场景核心读出这一帧的取景状态。 */
export function distanceContextOf(core: {
  camera: THREE.Camera
  controls: { target: THREE.Vector3 }
}): DistanceContext {
  return {
    cameraPosition: core.camera.position,
    orbitTarget: core.controls.target,
    camera: core.camera,
  }
}

/**
 * 造一个按参考系取距离的函数。
 *
 * ⚠ 取不到就给 null，不要拿 0 顶替：0 是一个**极近**的合法距离，会让
 * 「近于阈值时隐藏」当场成立，元素在模型还没加载完时先闪一下不见。
 *
 * @param context 这一帧的取景状态
 * @param selfPosition 元素自己的世界坐标；没有就给 null
 * @param partCenter 所属部件的包围盒中心；覆盖层元素没有部件，给 null
 */
export function distanceResolver(
  context: DistanceContext,
  selfPosition: Vec3 | THREE.Vector3 | null,
  partCenter: THREE.Vector3 | null,
): DistanceResolver {
  return (ref) => {
    if (ref === 'orbit') {
      return context.cameraPosition.distanceTo(context.orbitTarget)
    }
    if (ref === 'part-center') {
      // 覆盖层元素不属于任何部件，这个参考系对它没有意义 → 不限制
      return partCenter === null
        ? null
        : context.cameraPosition.distanceTo(partCenter)
    }
    if (selfPosition === null) return null
    const point =
      selfPosition instanceof THREE.Vector3
        ? selfPosition
        : SCRATCH.set(...selfPosition)
    return context.cameraPosition.distanceTo(point)
  }
}
