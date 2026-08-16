/**
 * @fileoverview 把位姿落到相机上的三条路：开屏初始取景、钻取取景快照、切视点。
 * 三者都要在改完之后叫一次 `controls.update()`，漏掉那一句的表现是「镜头没动，
 * 一拖才跳过去」。
 */
import type { TwinCamera, TwinConfig, TwinModalView } from '@dt/twin-config'
import { defaultCameraOf } from '@dt/twin-config'
import type { Object3D } from 'three'

import { applyCameraPose, frameObject, type SceneCore } from './sceneCore'

export interface SceneCameraOptions {
  core: () => SceneCore | null
  config: () => TwinConfig
}

export interface SceneCamera {
  /**
   * 模型装好后的初始取景：有视点就用标了默认的那个（没标则用第一个），
   * 一个视点都没配才把整个模型框进画面。
   */
  applyInitial: (root: Object3D) => void
  /** 把一个取景快照落到相机上；null / undefined = 不动镜头。 */
  applyView: (view: TwinModalView | null | undefined) => void
  /** 切到某个视点。 */
  applyCamera: (camera: TwinCamera) => void
}

/**
 * 装上相机动作。
 * @param options 场景内核与配置
 */
export function useSceneCamera(options: SceneCameraOptions): SceneCamera {
  function applyCamera(camera: TwinCamera): void {
    const core = options.core()
    if (core === null) return
    applyCameraPose(core, camera)
    core.controls.update()
  }

  return {
    applyCamera,

    // ⚠ 只在装载时用一次，不跟着配置每次重算——否则用户在运行态转了镜头，
    // 任何一次配置变更都会把镜头拽回默认机位
    applyInitial: (root) => {
      const core = options.core()
      if (core === null) return
      const camera = defaultCameraOf(options.config().cameras)
      if (camera === null) return frameObject(core, root)
      applyCamera(camera)
    },

    // ⚠ 只在换引用时飞一次，不每帧套——套住的话镜头就转不动了
    applyView: (view) => {
      const core = options.core()
      if (core === null || view === null || view === undefined) return
      applyCameraPose(core, view)
      core.controls.update()
    },
  }
}
