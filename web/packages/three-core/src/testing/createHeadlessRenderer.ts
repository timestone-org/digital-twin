/**
 * @fileoverview `SceneRenderer` 的 headless 适配器：happy-dom 里没有 WebGL，
 * 装配与销毁的用例靠它跑完整条路径，只记账不碰 GPU。
 */
import type * as THREE from 'three'

import type { SceneRenderer } from '../sceneCore'

export interface HeadlessRenderCall {
  scene: THREE.Object3D
  camera: THREE.Camera
}

export interface HeadlessRenderer extends SceneRenderer {
  readonly renders: HeadlessRenderCall[]
  readonly sizes: Array<{ width: number; height: number }>
  readonly pixelRatios: number[]
  disposeCount: number
  forceContextLossCount: number
}

/** 造一个不碰 GPU 的渲染器；`domElement` 是真 canvas，宿主要往上挂事件与样式。 */
export function createHeadlessRenderer(): HeadlessRenderer {
  const canvas = document.createElement('canvas')
  return {
    domElement: canvas,
    renders: [],
    sizes: [],
    pixelRatios: [],
    disposeCount: 0,
    forceContextLossCount: 0,
    render(scene: THREE.Object3D, camera: THREE.Camera): void {
      this.renders.push({ scene, camera })
    },
    setSize(width: number, height: number): void {
      this.sizes.push({ width, height })
    },
    setPixelRatio(value: number): void {
      this.pixelRatios.push(value)
    },
    setClearColor(): void {
      // 清屏色对无 GPU 的替身没有可观察效果，记账也没人断言
    },
    dispose(): void {
      this.disposeCount += 1
    },
    forceContextLoss(): void {
      this.forceContextLossCount += 1
    },
  }
}
