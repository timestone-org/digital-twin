/** @fileoverview 保留编辑手柄等不做深度测试的前景对象，避免被卡片合成覆盖。 */
import * as THREE from 'three'

function foreground(object: THREE.Object3D): boolean {
  const material: unknown = 'material' in object ? object.material : null
  const materials: unknown[] = Array.isArray(material) ? material : [material]
  return (
    materials.length > 0 &&
    materials.every(
      (item) =>
        item instanceof THREE.Material &&
        item.visible &&
        !item.depthTest &&
        item.opacity > 0,
    )
  )
}

export class PanelForeground {
  readonly scene = new THREE.Scene()
  private copies = new Map<THREE.Object3D, THREE.Object3D>()
  private sources: THREE.Object3D[] = []
  private hidden = false

  collect(root: THREE.Object3D, modelRoot: THREE.Object3D | undefined): void {
    const sources: THREE.Object3D[] = []
    const visit = (object: THREE.Object3D): void => {
      if (object === modelRoot || !object.visible) return
      if (foreground(object)) sources.push(object)
      for (const child of object.children) visit(child)
    }
    visit(root)
    this.sources = sources
    const active = new Set(sources)
    for (const [source, copy] of this.copies) {
      if (active.has(source)) continue
      copy.removeFromParent()
      this.copies.delete(source)
    }
    for (const source of sources) {
      if (this.copies.has(source)) continue
      const copy =
        source instanceof THREE.Box3Helper
          ? new THREE.LineSegments(source.geometry, source.material)
          : source.clone(false)
      copy.matrixAutoUpdate = false
      this.copies.set(source, copy)
      this.scene.add(copy)
    }
  }

  hide(): void {
    this.hidden = true
    for (const source of this.sources) source.visible = false
  }
  restore(): void {
    if (!this.hidden) return
    this.hidden = false
    for (const source of this.sources) source.visible = true
  }

  sync(): boolean {
    for (const [source, copy] of this.copies) {
      copy.matrix.copy(source.matrixWorld)
      if ('material' in source && 'material' in copy)
        copy.material = source.material
      if ('geometry' in source && 'geometry' in copy)
        copy.geometry = source.geometry
      copy.layers.mask = source.layers.mask
      copy.renderOrder = source.renderOrder
    }
    return this.copies.size > 0
  }

  dispose(): void {
    this.restore()
    this.sources = []
    this.copies.clear()
    // 副本共享原对象的几何和材质，资源归原场景所有。
    this.scene.clear()
  }
}
