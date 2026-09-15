/** @fileoverview 信息牌的透明 WebGL 平面及合并纹理更新、资源释放。 */
import * as THREE from 'three'
import type { CSS3DObject } from 'three/examples/jsm/renderers/CSS3DRenderer.js'

import {
  rasterizePanel,
  type PanelRasterizer,
  type PanelRaster,
} from './panelRaster'

/** 动态装饰纹理刷新间隔，毫秒。 */
const REFRESH_MS = 100

export class PanelSurface {
  readonly mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({
      transparent: true,
      depthTest: true,
      depthWrite: true,
      alphaTest: 0.01,
      side: THREE.DoubleSide,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    }),
  )
  private dirty = true
  private disposed = false
  private pending: Promise<void> | null = null
  private nextRefresh = 0
  private appearance = ''
  private opacity = 1

  constructor(
    private readonly label: CSS3DObject,
    private readonly animated = false,
    private readonly rasterize: PanelRasterizer = rasterizePanel,
  ) {
    this.mesh.name = 'twin-panel-surface'
    this.mesh.visible = false
    this.mesh.raycast = () => {}
    label.add(this.mesh)
    label.element.style.opacity = '0'
  }

  invalidate(): void {
    this.dirty = true
  }

  setOpacity(opacity: number): void {
    this.opacity = opacity
    this.mesh.material.opacity = opacity
    this.label.element.style.opacity = this.label.element.dataset.textureError
      ? String(opacity)
      : '0'
  }

  /** 合并读数与主题变更，每张牌最多一项在途绘制。
   * @param now 帧时钟，毫秒
   */
  update(now = performance.now()): void {
    if (
      this.disposed ||
      !this.label.visible ||
      !this.label.element.isConnected ||
      this.pending !== null
    )
      return
    if (now < this.nextRefresh) return
    this.nextRefresh = now + REFRESH_MS
    const style = getComputedStyle(this.label.element)
    const appearance = [
      'color',
      '--tp-accent',
      '--tp-bg',
      '--text-muted',
      '--border-color',
    ]
      .map((name) => style.getPropertyValue(name))
      .join('|')
    if (appearance !== this.appearance || this.animated) this.dirty = true
    this.appearance = appearance
    if (!this.dirty) return
    this.dirty = false
    this.pending = this.refresh().finally(() => {
      this.pending = null
    })
  }

  private async refresh(): Promise<void> {
    try {
      const raster = await this.rasterize(this.label.element)
      if (this.disposed) return
      if (raster === null) {
        this.dirty = true
        return
      }
      this.applyRaster(raster)
      delete this.label.element.dataset.textureError
      this.label.element.removeAttribute('title')
      this.label.element.style.opacity = '0'
    } catch {
      if (this.disposed) return
      this.mesh.visible = false
      this.label.element.dataset.textureError = '信息牌纹理生成失败'
      this.label.element.title = '信息牌纹理生成失败，暂时显示文字牌'
      this.label.element.style.opacity = String(this.opacity)
    }
  }

  private applyRaster(raster: PanelRaster): void {
    const previous = this.mesh.material.map
    const texture = new THREE.CanvasTexture(raster.canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    this.mesh.material.map = texture
    this.mesh.material.needsUpdate = true
    this.mesh.scale.set(raster.width, raster.height, 1)
    this.mesh.position.set(
      raster.x + raster.width / 2,
      -raster.y - raster.height / 2,
      0,
    )
    this.mesh.visible = true
    previous?.dispose()
  }

  dispose(): void {
    this.disposed = true
    this.mesh.removeFromParent()
    this.mesh.geometry.dispose()
    this.mesh.material.map?.dispose()
    this.mesh.material.dispose()
  }
}
