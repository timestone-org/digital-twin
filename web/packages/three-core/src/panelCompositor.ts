/** @fileoverview 原生卡片夹在场景底层与深度前景之间，样式不参与栅格化。 */
import * as THREE from 'three'
import { PanelSurface } from './panelSurface'
import { PanelForeground } from './panelForeground'

type BackdropContext = Pick<CanvasRenderingContext2D, 'clearRect' | 'drawImage'>
interface PanelRenderer {
  readonly domElement: HTMLCanvasElement
  autoClear: boolean
  clippingPlanes: THREE.Plane[]
  render(scene: THREE.Object3D, camera: THREE.Camera): void
}

export class PanelCompositor {
  readonly element = document.createElement('div')
  readonly canvas = document.createElement('canvas')
  private readonly clip = document.createElementNS(
    'http://www.w3.org/2000/svg',
    'clipPath',
  )
  private readonly holes = new THREE.Scene()
  private readonly foreground = new PanelForeground()
  private readonly projection = new THREE.Matrix4()
  private readonly context: BackdropContext | null
  private surfaces: PanelSurface[] = []
  private width = 1
  private height = 1

  constructor(
    private readonly renderer: PanelRenderer,
    context?: BackdropContext | null,
  ) {
    this.context =
      context === undefined ? this.canvas.getContext('2d') : context
    this.element.style.display = 'none'
    this.element.className = 'twin-panel-backdrop'
    this.canvas.style.cssText = 'width:100%;height:100%;display:block'
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.style.cssText = 'position:absolute;width:0;height:0;overflow:visible'
    this.clip.id = `panel-clip-${crypto.randomUUID()}`
    this.clip.setAttribute('clipPathUnits', 'userSpaceOnUse')
    svg.append(this.clip)
    this.canvas.style.clipPath = `url(#${this.clip.id})`
    this.element.append(this.canvas, svg)
  }

  resize(width: number, height: number): void {
    this.width = width
    this.height = height
  }

  render(
    scene: THREE.Scene,
    labels: THREE.Object3D,
    camera: THREE.Camera,
    modelRoot?: THREE.Object3D,
  ): void {
    if (this.context === null) {
      this.renderer.render(scene, camera)
      return
    }
    camera.updateMatrixWorld()
    this.projection.multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse,
    )
    const surfaces: PanelSurface[] = []
    labels.traverseVisible((node) => {
      if (
        node instanceof PanelSurface &&
        camera.layers.test(node.layers) &&
        node.sync(this.projection, this.width, this.height)
      )
        surfaces.push(node)
    })
    this.reconcile(surfaces)
    this.element.style.display = surfaces.length === 0 ? 'none' : ''
    if (surfaces.length === 0) {
      this.renderer.render(scene, camera)
      return
    }
    this.foreground.collect(scene, modelRoot)
    this.foreground.hide()
    try {
      this.renderer.render(scene, camera)
    } finally {
      this.foreground.restore()
    }
    const source = this.renderer.domElement
    if (this.canvas.width !== source.width) this.canvas.width = source.width
    if (this.canvas.height !== source.height) this.canvas.height = source.height
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height)
    this.context.drawImage(source, 0, 0)
    this.renderHoles(camera)
  }

  private reconcile(surfaces: PanelSurface[]): void {
    if (
      surfaces.length === this.surfaces.length &&
      surfaces.every((surface, index) => surface === this.surfaces[index])
    )
      return
    this.surfaces = surfaces
    this.clip.replaceChildren(...surfaces.map((surface) => surface.clipPolygon))
    this.holes.clear()
    if (surfaces.length > 0)
      this.holes.add(...surfaces.map((surface) => surface.proxy))
  }

  private renderHoles(camera: THREE.Camera): void {
    const autoClear = this.renderer.autoClear
    const clipping = this.renderer.clippingPlanes
    try {
      this.renderer.autoClear = false
      this.renderer.clippingPlanes = []
      this.renderer.render(this.holes, camera)
      this.renderer.clippingPlanes = clipping
      if (this.foreground.sync())
        this.renderer.render(this.foreground.scene, camera)
    } finally {
      this.renderer.autoClear = autoClear
      this.renderer.clippingPlanes = clipping
    }
  }

  dispose(): void {
    this.foreground.dispose()
    this.holes.clear()
    this.surfaces = []
    this.clip.replaceChildren()
    this.canvas.width = 0
    this.canvas.height = 0
    this.element.remove()
  }
}
