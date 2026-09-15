/** @fileoverview 配置预览的临时模型隔离，恢复时不修改持久化显隐。 */
import * as THREE from 'three'
import { objectsOfNames, type NodeIndex } from './nodeIndex'
export class PreviewIsolation {
  private readonly previous = new Map<THREE.Object3D, boolean>()
  restore(): void {
    for (const [object, visible] of this.previous) object.visible = visible
    this.previous.clear()
  }
  apply(
    root: THREE.Object3D,
    index: NodeIndex,
    names: readonly string[],
  ): THREE.Box3 | null {
    this.restore()
    const targets = objectsOfNames(index, names)
    const kept = new Set<THREE.Object3D>()
    const box = new THREE.Box3()
    for (const target of targets) {
      target.traverse((object) => kept.add(object))
      box.expandByObject(target)
      let ancestor = target.parent
      while (ancestor !== null) {
        kept.add(ancestor)
        ancestor = ancestor.parent
      }
    }
    root.traverse((object) => {
      this.previous.set(object, object.visible)
      object.visible = kept.has(object)
    })
    return box.isEmpty() ? null : box
  }
}
