/**
 * @fileoverview 把位姿落到相机上的三条路：开屏初始取景（瞬时落位）、钻取取景
 * 快照与切视点（都走飞行）。瞬时那条改完要叫一次 `controls.update()`，漏掉那
 * 一句的表现是「镜头没动，一拖才跳过去」。
 */
import type { TwinCamera, TwinConfig, TwinModalView } from '@dt/twin-config'
import { defaultCameraOf } from '@dt/twin-config'
import type { Object3D } from 'three'

import { createCameraFlight, type CameraFlight } from './cameraFlight'
import { applyCameraPose, frameObject, type SceneCore } from './sceneCore'

export interface SceneCameraOptions {
  core: () => SceneCore | null
  config: () => TwinConfig
  /** 模型包围盒对角线；剪裁面要罩得住星空那一层壳。 */
  span: () => number
}

export interface SceneCamera {
  /**
   * 模型装好后的初始取景：有视点就用标了默认的那个（没标则用第一个），
   * 一个视点都没配才把整个模型框进画面。
   */
  applyInitial: (root: Object3D) => void
  /** 飞到一个取景快照上；null / undefined = 不动镜头。 */
  applyView: (view: TwinModalView | null | undefined) => void
  /** 飞到某个视点。 */
  applyCamera: (camera: TwinCamera) => void
  /**
   * 场上唯一的一段相机飞行，定位/拉近等其它镜头动作共用。
   * 宿主要在渲染循环里逐帧 `advance`，并把 `cancel` 挂到用户接管的事件上。
   */
  flight: CameraFlight
}

/**
 * 装上相机动作。
 * @param options 场景内核与配置
 */
export function useSceneCamera(options: SceneCameraOptions): SceneCamera {
  const flight = createCameraFlight()
  return {
    flight,

    applyCamera: (camera) => {
      const core = options.core()
      if (core === null) return
      flight.flyTo(core, camera, options.span())
    },

    // ⚠ 只在装载时用一次，不跟着配置每次重算——否则用户在运行态转了镜头，
    // 任何一次配置变更都会把镜头拽回默认机位。
    // 落位是瞬时的：此刻相机还站在装配缺省位上，从那里飞过去毫无意义。
    applyInitial: (root) => {
      const core = options.core()
      if (core === null) return
      const camera = defaultCameraOf(options.config().cameras)
      if (camera === null) return frameObject(core, root)
      applyCameraPose(core, camera, options.span())
      core.controls.update()
    },

    // ⚠ 只在换引用时飞一次，不每帧套——套住的话镜头就转不动了
    applyView: (view) => {
      const core = options.core()
      if (core === null || view === null || view === undefined) return
      flight.flyTo(core, view, options.span())
    },
  }
}
