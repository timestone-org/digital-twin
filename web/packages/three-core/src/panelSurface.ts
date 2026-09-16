/** @fileoverview 原生 CSS3D 信息牌与只用于深度合成的透明代理面。 */
import * as THREE from 'three'
import { CSS3DObject } from 'three/examples/jsm/renderers/CSS3DRenderer.js'
import { measurePanelBounds, type PanelBounds } from './panelBounds'
import { projectPanel } from './panelProjection'

export class PanelSurface extends CSS3DObject {
  readonly proxy = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({
      color: 0x000000,
      opacity: 0,
      transparent: true,
      blending: THREE.NoBlending,
      depthTest: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    }),
  )
  readonly clipPolygon = document.createElementNS(
    'http://www.w3.org/2000/svg',
    'polygon',
  )
  private readonly observer: ResizeObserver
  private bounds: PanelBounds | null = null
  private dirty = true
  private disposed = false
  private readonly local = new THREE.Matrix4()
  private readonly projection = new THREE.Matrix4()
  private previousPoints = ''
  private isBackReading = false
  private readonly viewer = new THREE.Vector3()
  private readonly inverseWorld = new THREE.Matrix4()

  constructor(element: HTMLElement) {
    super(element)
    this.proxy.matrixAutoUpdate = false
    this.proxy.name = 'twin-panel-depth-proxy'
    this.observer = new ResizeObserver(() => {
      this.dirty = true
    })
    for (const child of element.children) this.observer.observe(child)
  }

  invalidateBounds(): void {
    this.dirty = true
  }

  /** 保持牌面不动，仅补偿背面阅读的水平镜像。
   * @param camera 当前相机
   */
  updateReadingSide(camera: THREE.Camera): void {
    this.updateWorldMatrix(true, false)
    this.inverseWorld.copy(this.matrixWorld).invert()
    if (camera instanceof THREE.OrthographicCamera) {
      camera.getWorldDirection(this.viewer).negate()
      this.viewer.transformDirection(this.inverseWorld)
    } else {
      camera.getWorldPosition(this.viewer)
      this.viewer.applyMatrix4(this.inverseWorld)
    }
    const isBack = this.viewer.z < 0
    if (isBack === this.isBackReading) return
    this.isBackReading = isBack
    this.element.style.setProperty('--tp-reading-x', isBack ? '-1' : '1')
    this.invalidateBounds()
  }

  sync(viewProjection: THREE.Matrix4, width: number, height: number): boolean {
    if (this.disposed || !this.element.isConnected) return false
    if (this.dirty) {
      this.bounds = measurePanelBounds(this.element)
      this.dirty = this.bounds === null
    }
    if (this.bounds === null) return false
    const { x, y, width: w, height: h } = this.bounds
    this.updateWorldMatrix(true, false)
    this.local.makeScale(w, h, 1).setPosition(x + w / 2, -y - h / 2, 0)
    this.proxy.matrix.multiplyMatrices(this.matrixWorld, this.local)
    this.proxy.layers.mask = this.layers.mask
    this.projection.multiplyMatrices(viewProjection, this.proxy.matrix)
    const points = projectPanel(this.projection, width, height)
    if (points !== this.previousPoints) {
      this.clipPolygon.setAttribute('points', points)
      this.previousPoints = points
    }
    this.element.style.visibility = points === '' ? 'hidden' : ''
    return points !== ''
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.observer.disconnect()
    this.clipPolygon.remove()
    this.proxy.removeFromParent()
    this.proxy.geometry.dispose()
    this.proxy.material.dispose()
    this.element.remove()
  }
}
