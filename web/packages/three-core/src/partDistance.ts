/**
 * @fileoverview 部件的距离显隐与淡出，外加点击要用的部件包围盒中心。
 *
 * ⚠ 淡出必须先把材质**克隆**一份再调透明度：GLB 里的材质常被多个网格共用，
 * 直接改原材质会把毫不相干的部位一起调暗，而且看不出是谁干的。克隆只挂在
 * 本部件命中的网格上，随本层一起释放。
 * ⚠ 同一个网格被两个部件同时命中时，后建的那个部件说了算——这是配置本身的
 * 歧义，渲染层不猜，也不报错。
 */
import type { TwinPart } from '@dt/twin-config'
import * as THREE from 'three'

import { distanceResolver, type DistanceContext } from './distanceContext'
import { resolveVisibility } from './distanceRules'
import { meshesOfNames, objectsOfNames, type NodeIndex } from './nodeIndex'

interface PartEntry {
  part: TwinPart
  objects: THREE.Object3D[]
  /** 世界包围盒；部件没命中任何东西时为 null。 */
  box: THREE.Box3 | null
  /** 包围盒中心；算不出来时为 null。 */
  center: THREE.Vector3 | null
  /** 只有配了淡出的部件才克隆材质，其余为空。 */
  faded: FadedMesh[]
}

interface FadedMesh {
  mesh: THREE.Mesh
  /** 克隆出来的材质，卸载时由本层释放。 */
  clones: THREE.Material[]
  /** 克隆前各材质自己的不透明度，淡出按它成比例缩。 */
  baseOpacity: number[]
}

function materialsOf(mesh: THREE.Mesh): THREE.Material[] {
  return Array.isArray(mesh.material) ? mesh.material : [mesh.material]
}

/** 把网格的材质换成克隆件并打开透明通道。 */
function cloneMaterials(mesh: THREE.Mesh): FadedMesh {
  const clones = materialsOf(mesh).map((material) => {
    const copy = material.clone()
    copy.transparent = true
    return copy
  })
  const baseOpacity = clones.map((material) => material.opacity)
  mesh.material = clones.length === 1 ? (clones[0] ?? mesh.material) : clones
  return { mesh, clones, baseOpacity }
}

/** 部件的世界包围盒；一个对象都没命中时给 null。 */
function boxOf(objects: readonly THREE.Object3D[]): THREE.Box3 | null {
  if (objects.length === 0) return null
  const box = new THREE.Box3()
  for (const object of objects) box.expandByObject(object)
  return box.isEmpty() ? null : box
}

/** 部件的距离规则层。换模型或换配置时 `build` 重建。 */
export class PartDistanceLayer {
  private entries: PartEntry[] = []

  /**
   * 按当前模型与配置建索引。
   * @param index 模型节点索引
   * @param parts 归一化后的部件
   */
  build(index: NodeIndex, parts: readonly TwinPart[]): void {
    this.clear()
    for (const part of parts) {
      const objects = objectsOfNames(index, part.nodes)
      const box = boxOf(objects)
      this.entries.push({
        part,
        objects,
        box,
        center: box === null ? null : box.getCenter(new THREE.Vector3()),
        faded:
          part.visibility.fade === null
            ? []
            : meshesOfNames(index, part.nodes).map(cloneMaterials),
      })
    }
  }

  /**
   * 按这一帧的取景状态更新显隐与淡出。
   * @param context 这一帧的相机与轨道中心
   */
  apply(context: DistanceContext): void {
    for (const entry of this.entries) {
      const state = resolveVisibility(
        entry.part.visibility,
        distanceResolver(context, entry.center, entry.center),
      )
      for (const object of entry.objects) object.visible = state.visible
      for (const faded of entry.faded) {
        faded.clones.forEach((material, index) => {
          material.opacity = (faded.baseOpacity[index] ?? 1) * state.opacity
        })
      }
    }
  }

  /**
   * 射线命中的对象属于哪个部件；顺着父链往上找。
   * ⚠ 命中的是网格，而部件寻址的是它的某个**祖先**节点名——只比对象本身的话，
   * 点在模型上永远找不到部件，表现为「点了没反应」。
   * @param object 射线命中的对象
   */
  partAt(object: THREE.Object3D): TwinPart | null {
    for (let node: THREE.Object3D | null = object; node; node = node.parent) {
      const owner = this.entries.find((entry) => entry.objects.includes(node))
      if (owner !== undefined) return owner.part
    }
    return null
  }

  /**
   * 某个部件的包围盒中心，点击门禁要用它算 `part-center` 距离。
   * @param partId 部件 id
   */
  centerOf(partId: string): THREE.Vector3 | null {
    return this.entries.find((entry) => entry.part.id === partId)?.center ?? null
  }

  /**
   * 某个部件的世界包围盒；`approach` 那一下要用它把镜头拉过去。
   * @param partId 部件 id
   */
  boxOf(partId: string): THREE.Box3 | null {
    return this.entries.find((entry) => entry.part.id === partId)?.box ?? null
  }

  dispose(): void {
    this.clear()
  }

  // ⚠ 克隆出来的材质没人替我们收：模型被卸载时释放的是它自己那份原始材质
  private clear(): void {
    for (const entry of this.entries) {
      for (const faded of entry.faded) {
        for (const material of faded.clones) material.dispose()
      }
    }
    this.entries = []
  }
}
