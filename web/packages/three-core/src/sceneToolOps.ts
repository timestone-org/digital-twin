/**
 * @fileoverview 场景工具里直接操作 three 的那几支：并包围盒、取图、套剖切面。
 * 与 `useSceneTools` 分开放——那边只管状态与响应，这里只管对场景做什么。
 */
import {
  clipPlaneFor,
  screenshotFileName,
  screenshotStamp,
  type TwinClipAxis,
} from '@dt/twin-config'
import * as THREE from 'three'

import type { NodeIndex } from './nodeIndex'
import type { SceneCore } from './sceneCore'

/** 把一组节点名并成一个包围盒；一个都找不到时给 null。 */
export function boxOfNames(
  index: NodeIndex,
  names: readonly string[],
): THREE.Box3 | null {
  const box = new THREE.Box3()
  let found = false
  for (const name of names) {
    for (const object of index.byName.get(name) ?? []) {
      box.expandByObject(object)
      found = true
    }
  }
  return found ? box : null
}

/** 导出当前画面。 */
export function saveScreenshot(core: SceneCore | null, title: string): void {
  if (core === null || typeof document === 'undefined') return
  // ⚠ 必须先画一帧再取：WebGL 的后备缓冲在下一帧就被清了，
  // 直接 toDataURL 多半拿到一张全黑
  core.renderer.render(core.scene, core.camera)
  let url = ''
  try {
    url = core.renderer.domElement.toDataURL('image/png')
  } catch {
    // 画布被跨域素材污染时 toDataURL 抛错——放弃，不给用户一个坏文件
    return
  }
  const link = document.createElement('a')
  link.href = url
  link.download = screenshotFileName(
    title,
    screenshotStamp(new Date().toISOString()),
  )
  link.click()
}

/** 按当前轴与位置重算剖切面并套到渲染器。 */
export function applyClipping(
  core: SceneCore | null,
  axis: TwinClipAxis,
  ratio: number,
): void {
  if (core === null) return
  const box = new THREE.Box3().setFromObject(core.modelRoot)
  const along = axis === 'none' ? 'x' : axis
  const lo = box.isEmpty() ? Number.NaN : box.min[along]
  const hi = box.isEmpty() ? Number.NaN : box.max[along]
  const plane = clipPlaneFor(axis, ratio, lo, hi)
  core.renderer.clippingPlanes =
    plane === null
      ? []
      : [new THREE.Plane(new THREE.Vector3(...plane.normal), plane.constant)]
}
