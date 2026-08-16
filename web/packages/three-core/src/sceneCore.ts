/**
 * @fileoverview 场景 / 相机 / 渲染器 / 灯光的装配与销毁，以及模型的摆放与取景。
 * ⚠ three 的 GPU 资源 GC 收不走，释放全部收口在 `disposeScene`——它是本包
 * 「卸载必须清理」这条的落点（code-style-typescript §5.2）。
 */
import type { TwinModelRef, TwinPose } from '@dt/twin-config'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js'
import { CSS3DRenderer } from 'three/examples/jsm/renderers/CSS3DRenderer.js'

/** WebGL 不可用时的统一文案，降级提示由宿主渲染。 */
export const WEBGL_UNAVAILABLE_MESSAGE =
  '当前环境不支持 WebGL，无法渲染 3D 模型'

const CAMERA_FOV_DEG = 45
const INITIAL_NEAR = 0.01
const INITIAL_FAR = 5000
/** 像素比上限，高 DPR 屏封顶防显存撑爆 */
const MAX_PIXEL_RATIO = 2
/** 相机初始站位 */
const INITIAL_CAMERA_POSITION: readonly [number, number, number] = [6, 5, 8]
/** 取景方向 */
const FRAME_DIRECTION: readonly [number, number, number] = [1, 0.7, 1]
/** 取景留白系数 */
const FRAME_MARGIN = 1.25
/** 空模型的取景半径下限 */
const MIN_FRAME_RADIUS = 0.5
/** 近剪裁面相对相机距离的比例 */
const NEAR_RATIO = 1 / 1000
/** 远剪裁面相对相机距离的倍数 */
const FAR_FACTOR = 20
const WHITE = 0xffffff
/** 半球灯天空色 */
const SKY_COLOR = 0xbfe6ff
/** 半球灯地面色 */
const GROUND_COLOR = 0x0a1622
const HEMISPHERE_INTENSITY = 1
const AMBIENT_INTENSITY = 0.6
const KEY_LIGHT_INTENSITY = 2.2
const FILL_LIGHT_INTENSITY = 0.9

/**
 * 宿主用到的渲染器成员全集。
 * ⚠ 宿主只声明成本接口，用到接口外的成员即编译期报错——headless 替身与真渲染器
 * 的漂移由类型双向兜住，测试里那份不会悄悄少实现一个方法。
 */
export interface SceneRenderer {
  readonly domElement: HTMLCanvasElement
  /**
   * 全局剖切面；空数组 = 不剖切。
   * ⚠ 是可写属性不是方法：three 的 `WebGLRenderer` 就是这么用的，包一层 setter
   * 会让替身与真渲染器的用法分叉。
   */
  clippingPlanes: THREE.Plane[]
  render(scene: THREE.Object3D, camera: THREE.Camera): void
  setSize(width: number, height: number): void
  setPixelRatio(value: number): void
  setClearColor(color: THREE.ColorRepresentation, alpha?: number): void
  dispose(): void
  forceContextLoss(): void
}

/** 渲染器工厂：环境不可用时返回 null。 */
export type SceneRendererFactory = () => SceneRenderer | null

export interface SceneCore {
  readonly scene: THREE.Scene
  readonly camera: THREE.PerspectiveCamera
  readonly renderer: SceneRenderer
  readonly controls: OrbitControls
  readonly labelRenderer: CSS2DRenderer
  /**
   * 3D 空间里的 DOM 层，信息牌用它。
   * ⚠ 与 `labelRenderer` 是两回事：那一层是屏幕空间的，元素恒定像素大小、
   * 永远正对屏幕；这一层的元素真进 3D，会随距离透视、也能摆任意朝向。
   */
  readonly spatialRenderer: CSS3DRenderer
  /** 模型挂载点：换模型只清空它，灯光与锚点层不受影响。 */
  readonly modelRoot: THREE.Group
}

export interface SceneCoreOptions {
  /** canvas 与 CSS2D 标签层的宿主元素。 */
  container: HTMLElement
  renderer: SceneRenderer
}

function hasWebGL(): boolean {
  if (typeof document === 'undefined') return false
  try {
    const probe = document.createElement('canvas')
    return (
      probe.getContext('webgl2') !== null || probe.getContext('webgl') !== null
    )
  } catch {
    return false
  }
}

/** 真 WebGL 渲染器；环境不支持（happy-dom / 老浏览器）时返回 null。 */
export const createWebGLRenderer: SceneRendererFactory = () => {
  if (!hasWebGL()) return null
  return new THREE.WebGLRenderer({ alpha: true, antialias: true })
}

/**
 * 设备像素比，按上限夹取。
 * @param max 上限，缺省 2
 */
export function clampPixelRatio(max: number = MAX_PIXEL_RATIO): number {
  const ratio = typeof window === 'undefined' ? 1 : window.devicePixelRatio
  const usable = Number.isFinite(ratio) && ratio > 0 ? ratio : 1
  return Math.min(usable, max)
}

/** 让 canvas 与标签层各自铺满宿主；标签层不吃指针事件，否则 OrbitControls 收不到拖拽。 */
function fillContainer(element: HTMLElement, interactive: boolean): void {
  element.style.position = 'absolute'
  element.style.inset = '0'
  element.style.width = '100%'
  element.style.height = '100%'
  element.style.pointerEvents = interactive ? 'auto' : 'none'
}

/** 半球 + 环境 + 主次平行光，收进一个 Group 便于整组释放。 */
function createLighting(): THREE.Group {
  const group = new THREE.Group()
  group.name = 'twin-lighting'
  group.add(
    new THREE.HemisphereLight(SKY_COLOR, GROUND_COLOR, HEMISPHERE_INTENSITY),
  )
  group.add(new THREE.AmbientLight(WHITE, AMBIENT_INTENSITY))
  const key = new THREE.DirectionalLight(WHITE, KEY_LIGHT_INTENSITY)
  key.position.set(5, 8, 6)
  group.add(key)
  const fill = new THREE.DirectionalLight(WHITE, FILL_LIGHT_INTENSITY)
  fill.position.set(-6, -2, -4)
  group.add(fill)
  return group
}

/**
 * 装配一套可渲染的场景，并把两层画布挂进宿主元素。
 * @param options 宿主元素与已造好的渲染器
 */
export function createSceneCore(options: SceneCoreOptions): SceneCore {
  const { container, renderer } = options
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(
    CAMERA_FOV_DEG,
    1,
    INITIAL_NEAR,
    INITIAL_FAR,
  )
  camera.position.set(...INITIAL_CAMERA_POSITION)

  renderer.setPixelRatio(clampPixelRatio())
  renderer.setClearColor(0x000000, 0)
  fillContainer(renderer.domElement, true)
  container.appendChild(renderer.domElement)

  const labelRenderer = new CSS2DRenderer()
  fillContainer(labelRenderer.domElement, false)
  container.appendChild(labelRenderer.domElement)

  const spatialRenderer = new CSS3DRenderer()
  fillContainer(spatialRenderer.domElement, false)
  container.appendChild(spatialRenderer.domElement)

  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true

  const modelRoot = new THREE.Group()
  modelRoot.name = 'twin-model-root'
  scene.add(createLighting(), modelRoot)

  return {
    scene,
    camera,
    renderer,
    controls,
    labelRenderer,
    spatialRenderer,
    modelRoot,
  }
}

/**
 * 按宿主尺寸重算相机与两层画布。
 * @param core 场景内核
 * @param width 宿主宽度（CSS 像素）
 * @param height 宿主高度（CSS 像素）
 */
export function resizeScene(
  core: SceneCore,
  width: number,
  height: number,
): void {
  // ⚠ 下限取 1：宿主被折叠时 height 是 0，aspect 变 Infinity 会让投影矩阵整片 NaN，
  // 模型直接消失且控制台一声不吭
  const w = Math.max(1, Math.floor(width))
  const h = Math.max(1, Math.floor(height))
  core.camera.aspect = w / h
  core.camera.updateProjectionMatrix()
  core.renderer.setSize(w, h)
  core.labelRenderer.setSize(w, h)
  core.spatialRenderer.setSize(w, h)
}

/** 渲染一帧：阻尼需要每帧 update，否则惯性停在半路。 */
export function renderScene(core: SceneCore): void {
  core.controls.update()
  core.renderer.render(core.scene, core.camera)
  core.labelRenderer.render(core.scene, core.camera)
  core.spatialRenderer.render(core.scene, core.camera)
}

/**
 * 摆放三件套。⚠ 只要这三样而不是整个 `TwinModelRef`：多要一个字段就多一处
 * 「加了字段却要改调用点」，而摆放本身与素材、特效、动画毫无关系。
 */
export type ModelPlacement = Pick<
  TwinModelRef,
  'scale' | 'position' | 'rotation'
>

/**
 * 把配置里的摆放落到模型根上；旋转角配置里是度，three 要弧度。
 * @param root 模型根对象
 * @param model 归一化后的摆放
 */
export function applyModelPlacement(
  root: THREE.Object3D,
  model: ModelPlacement,
): void {
  const [rx, ry, rz] = model.rotation
  root.scale.setScalar(model.scale)
  root.position.set(...model.position)
  root.rotation.set(
    THREE.MathUtils.degToRad(rx),
    THREE.MathUtils.degToRad(ry),
    THREE.MathUtils.degToRad(rz),
  )
}

/**
 * 对象包围盒的对角线长度；空包围盒返回 0。
 * @param object 要量的对象
 */
export function boundingDiagonal(object: THREE.Object3D): number {
  const box = new THREE.Box3().setFromObject(object)
  return box.isEmpty() ? 0 : box.getSize(new THREE.Vector3()).length()
}

/**
 * 把相机拉到能完整看见对象的位置，并按包围盒收紧剪裁面。
 * @param core 场景内核
 * @param object 要取景的对象
 */
export function frameObject(core: SceneCore, object: THREE.Object3D): void {
  frameBox(core, new THREE.Box3().setFromObject(object))
}

/**
 * 把镜头对到一个包围盒上。部件由多个对象组成，框它们要先并出一个盒。
 * @param core 场景核心
 * @param box 世界坐标下的包围盒；空盒直接返回，不把镜头甩到原点
 */
export function frameBox(core: SceneCore, box: THREE.Box3): void {
  if (box.isEmpty()) return
  const center = box.getCenter(new THREE.Vector3())
  const radius = Math.max(
    box.getSize(new THREE.Vector3()).length() / 2,
    MIN_FRAME_RADIUS,
  )
  const halfFov = THREE.MathUtils.degToRad(core.camera.fov) / 2
  const distance = (radius / Math.sin(halfFov)) * FRAME_MARGIN
  const offset = new THREE.Vector3(...FRAME_DIRECTION)
    .normalize()
    .multiplyScalar(distance)
  core.camera.position.copy(center).add(offset)
  // ⚠ 剪裁面必须跟着包围盒走：固定的 0.01/5000 在大模型上深度精度不够，
  // 表面会互相穿插闪烁，而这既不报错也不好归因
  core.camera.near = Math.max(distance * NEAR_RATIO, INITIAL_NEAR)
  core.camera.far = distance * FAR_FACTOR
  core.camera.updateProjectionMatrix()
  core.controls.target.copy(center)
  core.controls.update()
}

/**
 * 把一个机位落到相机与轨道中心上。
 * ⚠ 不在这里调 `controls.update()`：渲染循环每帧已经调过一次，漫游逐帧落位姿
 * 时再调一次等于把阻尼多衰减一遍，转起来会发涩。要立刻生效的调用方自己补一次。
 * @param core 场景内核
 * @param pose 机位、注视点与视野
 */
export function applyCameraPose(core: SceneCore, pose: TwinPose): void {
  core.camera.position.set(...pose.position)
  core.camera.fov = pose.fov
  core.camera.updateProjectionMatrix()
  core.controls.target.set(...pose.target)
}

type Renderable = THREE.Mesh | THREE.Line | THREE.Points

function isRenderable(object: THREE.Object3D): object is Renderable {
  return (
    object instanceof THREE.Mesh ||
    object instanceof THREE.Line ||
    object instanceof THREE.Points
  )
}

/** ⚠ `Material.dispose()` 不带走贴图，而贴图槽的名字随材质类型变，只能按属性扫。 */
function disposeMaterial(material: THREE.Material): void {
  for (const key of Object.keys(material)) {
    const value = Reflect.get(material, key) as unknown
    if (value instanceof THREE.Texture) value.dispose()
  }
  material.dispose()
}

function collectMaterials(
  material: THREE.Material | THREE.Material[],
  into: Set<THREE.Material>,
): void {
  if (Array.isArray(material)) for (const item of material) into.add(item)
  else into.add(material)
}

/**
 * 逐个释放一棵对象图的灯光、几何、材质与贴图，并清空 root 的子节点。
 * @param root 要释放的子树根
 */
export function disposeSceneGraph(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>()
  const materials = new Set<THREE.Material>()
  root.traverse((object) => {
    if (object instanceof THREE.Light) object.dispose()
    if (!isRenderable(object)) return
    geometries.add(object.geometry)
    collectMaterials(object.material, materials)
  })
  for (const geometry of geometries) geometry.dispose()
  for (const material of materials) disposeMaterial(material)
  root.clear()
}

function disposeIfTexture(value: THREE.Texture | THREE.Color | null): void {
  if (value instanceof THREE.Texture) value.dispose()
}

/**
 * 卸载收口：控制器、CSS2D 容器、场景图资源、环境贴图与渲染上下文逐个释放。
 * @param core 场景内核
 */
export function disposeScene(core: SceneCore): void {
  core.controls.dispose()
  core.labelRenderer.domElement.remove()
  core.spatialRenderer.domElement.remove()
  disposeIfTexture(core.scene.environment)
  core.scene.environment = null
  disposeIfTexture(core.scene.background)
  core.scene.background = null
  disposeSceneGraph(core.scene)
  core.renderer.domElement.remove()
  core.renderer.dispose()
  // ⚠ dispose 之后还要主动丢上下文：浏览器同时存活的 WebGL 上下文有硬上限，
  // 来回切大屏会让最早的那个被静默回收，表现是某张大屏毫无征兆地黑掉
  core.renderer.forceContextLoss()
}
