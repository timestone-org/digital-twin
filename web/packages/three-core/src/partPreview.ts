/**
 * @fileoverview 弹窗里那一小块 3D：只装一个部件，自己一套场景、相机与渲染器。
 *
 * ⚠ 部件的对象是**克隆**进来的，几何与材质仍与画布上那棵模型树**共用**——所以
 * 释放时只许收自己造的那几样（灯光、控制器、渲染器），绝不能走
 * `disposeSceneGraph`：那会把主场景正在用的几何与材质一并释放，表现是大屏上
 * 那个部件整块消失，而这里已经关掉了、没有任何线索指回来。
 * ⚠ 克隆要把祖先的变换**烘进去**：`clone()` 只带自己那一层的 position/rotation，
 * 挂在别处的部件会以模型原点为准摆放，看着像「模型跑到画面外去了」。
 * ⚠ 上下文有硬上限：开一次弹窗多一个 WebGL 上下文，关掉必须 `forceContextLoss`，
 * 否则来回点几次部件之后最早的那个会被浏览器静默回收，主画布毫无征兆地黑掉。
 * ⚠ 父件带着后代一起进来时先按祖先关系去重：GLB 里子件的网格通常就挂在父件节点
 * 下面，不去重就是同一块几何重叠着画两遍，表面闪烁得像模型坏了。
 */
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

import {
  clampPixelRatio,
  createWebGLRenderer,
  type SceneRenderer,
  type SceneRendererFactory,
} from './sceneCore'

/** 视野，与主画布同一档，换个视野会让同一个部件看着胖瘦不同。 */
const PREVIEW_FOV_DEG = 45
/** 自转速度，度/秒。慢到能看清结构，又不至于像没在动。 */
const SPIN_DEG_PER_S = 12
/** 剪裁面按部件体量给，固定值在小件上会把它整个裁掉。 */
const NEAR_RATIO = 0.01
const FAR_RATIO = 40
/** 近剪裁面的下限；再小会让深度精度不够，表面互相穿插闪烁。 */
const MIN_NEAR = 1e-3
/** 取景留白，1 = 贴边。 */
const FIT_MARGIN = 1.06
/** 取景方向，与主画布同一档，换个方向会让同一个部件看着不是同一件东西。 */
const FIT_DIRECTION: readonly [number, number, number] = [1, 0.7, 1]
/** 体量为 0 的部件（单个点）也得有个距离，否则相机与它重合。 */
const MIN_FIT_DISTANCE = 0.5

export interface PartPreviewOptions {
  /** 画布挂到这里。 */
  container: HTMLElement
  /** 要展示的对象，画布上那棵模型树里的原件。 */
  objects: readonly THREE.Object3D[]
  autoRotate: boolean
  /** 渲染器工厂；测试里换成 headless 替身。 */
  renderer?: SceneRendererFactory
}

export interface PartPreview {
  /** 按宿主尺寸重算相机与画布，并（在用户还没动过镜头时）重新取景。 */
  measure: (width: number, height: number) => void
  /** 推进并画一帧。 */
  frame: (deltaS: number) => void
  /** 用户接管了镜头，之后不再自动取景。 */
  releaseFraming: () => void
  dispose: () => void
}

/** 半球 + 环境 + 一盏主光：够看清形体，不追求与主画布逐灯一致。 */
function createLighting(): THREE.Group {
  const group = new THREE.Group()
  group.add(new THREE.HemisphereLight(0xdfefff, 0x202634, 1.1))
  group.add(new THREE.AmbientLight(0xffffff, 0.6))
  const key = new THREE.DirectionalLight(0xffffff, 1.1)
  key.position.set(5, 8, 6)
  group.add(key)
  return group
}

/**
 * 把一个对象连同祖先的变换克隆出来。
 * ⚠ 先清掉自己那一层的变换再叠世界矩阵：不清的话它自己那一份会被算两遍。
 */
function bakedClone(source: THREE.Object3D): THREE.Object3D {
  const clone = source.clone()
  clone.position.set(0, 0, 0)
  clone.quaternion.identity()
  clone.scale.set(1, 1, 1)
  source.updateWorldMatrix(true, false)
  clone.applyMatrix4(source.matrixWorld)
  return clone
}

/** 这个对象的某个祖先也在清单里吗。 */
function hasAncestorIn(
  object: THREE.Object3D,
  all: ReadonlySet<THREE.Object3D>,
): boolean {
  let cursor = object.parent
  while (cursor !== null) {
    if (all.has(cursor)) return true
    cursor = cursor.parent
  }
  return false
}

/**
 * 丢掉重复的、以及祖先已经在清单里的对象。
 * ⚠ 父件与子件在 GLB 里常常就是同一棵树上的两层：两份一起克隆进来，同一块几何
 * 会严丝合缝地重叠着画两遍，表面互相穿插闪烁——看着像模型本身坏了，而没有任何
 * 日志指回这里。
 * @param objects 要展示的对象，可能来自一个部件与它的全部后代
 */
export function dropNestedObjects(
  objects: readonly THREE.Object3D[],
): THREE.Object3D[] {
  const all = new Set(objects)
  const kept = new Set<THREE.Object3D>()
  const out: THREE.Object3D[] = []
  for (const object of objects) {
    if (kept.has(object) || hasAncestorIn(object, all)) continue
    kept.add(object)
    out.push(object)
  }
  return out
}

/**
 * 把相机摆到「刚好装下这个部件」的距离上。
 *
 * ⚠ 不按外接球算：一台长条形的机组，外接球半径由**长度**决定，于是相机被推到
 * 很远，画面里那个部件只占中间一小块——舞台再放大也只是黑边变多。
 * ⚠ 横向按 **XZ 平面的外接半径**而不是盒宽：自转是绕竖轴转的，按盒宽贴边取景
 * 的话，长轴转到正对镜头那一刻两头会被裁掉。
 * @param camera 预览相机，`aspect` 必须已经是当前舞台的
 * @param box 已居中到原点的包围盒
 */
export function fitDistance(
  camera: THREE.PerspectiveCamera,
  box: THREE.Box3,
): number {
  const size = box.getSize(new THREE.Vector3())
  const halfFov = THREE.MathUtils.degToRad(camera.fov) / 2
  const halfFovX = Math.atan(Math.tan(halfFov) * camera.aspect)
  // 自转一圈扫出来的是个圆柱：半径按 XZ 外接圆，高按盒高
  const radius = Math.hypot(size.x, size.z) / 2
  // 横向是「圆与视锥相切」，与取景一个球同一支公式
  const forWidth = radius / Math.sin(halfFovX)
  // ⚠ 竖向要多让出一个半径：顶边最靠近镜头的那一点比中心近这么多，不让的话
  //   又高又细的部件转到侧面时会被上下切掉
  const forHeight = size.y / 2 / Math.tan(halfFov) + radius
  return Math.max(forWidth, forHeight) * FIT_MARGIN
}

/** 把相机摆到取景位；`box` 已居中到原点，故注视点就是原点。 */
function frameBox(
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  box: THREE.Box3,
): void {
  if (box.isEmpty()) return
  const distance = Math.max(fitDistance(camera, box), MIN_FIT_DISTANCE)
  camera.position
    .set(...FIT_DIRECTION)
    .normalize()
    .multiplyScalar(distance)
  controls.target.set(0, 0, 0)
  controls.update()
}

/** 把这一组对象搬到原点附近，免得相机得先飞很远才看得见。 */
function centerAt(group: THREE.Group): THREE.Box3 {
  const box = new THREE.Box3().setFromObject(group)
  if (box.isEmpty()) return box
  const center = box.getCenter(new THREE.Vector3())
  group.position.sub(center)
  return box.translate(center.clone().negate())
}

/**
 * 造一块只装这个部件的预览。渲染器造不出来（无 WebGL）时给 null。
 * @param options 宿主元素、要展示的对象与自转开关
 */
export function createPartPreview(
  options: PartPreviewOptions,
): PartPreview | null {
  const renderer: SceneRenderer | null = (
    options.renderer ?? createWebGLRenderer
  )()
  if (renderer === null) return null

  const scene = new THREE.Scene()
  const lighting = createLighting()
  const stage = new THREE.Group()
  for (const object of dropNestedObjects(options.objects)) {
    stage.add(bakedClone(object))
  }
  const box = centerAt(stage)
  scene.add(lighting, stage)

  const camera = new THREE.PerspectiveCamera(PREVIEW_FOV_DEG, 1, MIN_NEAR, 1)
  renderer.setPixelRatio(clampPixelRatio())
  renderer.setClearColor(0x000000, 0)
  const canvas = renderer.domElement
  canvas.style.position = 'absolute'
  canvas.style.inset = '0'
  canvas.style.width = '100%'
  canvas.style.height = '100%'
  options.container.append(canvas)

  const controls = new OrbitControls(camera, canvas)
  controls.enableDamping = true
  // 平移会把部件推出画面，而这块预览没有「回到中心」的入口
  controls.enablePan = false

  // ⚠ 真正的取景在 `measure` 里做：那时才知道舞台的宽高比，而宽高比正是
  //   「长条形部件能不能填满画面」的决定项。这里只先给一个不至于把它裁掉的距离
  frameBox(camera, controls, box)

  const handle = makeHandle({
    renderer,
    scene,
    camera,
    controls,
    canvas,
    stage,
    lighting,
    box,
    span: box.isEmpty() ? 1 : box.getSize(new THREE.Vector3()).length(),
    autoRotate: options.autoRotate,
  })
  // 用户一碰控制器就不再自动取景：换宽高比时把他正看的角度拽走比画面小更糟
  controls.addEventListener('start', handle.releaseFraming)
  return handle
}

/** 造好之后能对外做的三件事：量尺寸、推一帧、释放。 */
interface HandleParts {
  renderer: SceneRenderer
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  controls: OrbitControls
  canvas: HTMLCanvasElement
  stage: THREE.Group
  lighting: THREE.Group
  /** 已居中到原点的包围盒，换宽高比时按它重新取景。 */
  box: THREE.Box3
  /** 取景内容的体量，剪裁面按它给。 */
  span: number
  autoRotate: boolean
}

function makeHandle(parts: HandleParts): PartPreview {
  const { renderer, scene, camera, controls, canvas, stage, lighting } = parts
  /** 用户还没碰过镜头：换宽高比时可以替他重新取景。 */
  let framing = true
  // ⚠ 具名函数：内联箭头那个 `removeEventListener` 摘不掉，每开一次弹窗就往
  //   控制器上多留一个
  function releaseFraming(): void {
    framing = false
  }
  return {
    releaseFraming,

    measure: (width, height) => {
      // ⚠ 下限取 1：宿主被折叠时 height 是 0，aspect 变 Infinity 会让投影矩阵
      //   整片 NaN，模型直接消失且控制台一声不吭
      const w = Math.max(1, Math.floor(width))
      const h = Math.max(1, Math.floor(height))
      camera.aspect = w / h
      camera.near = Math.max(parts.span * NEAR_RATIO, MIN_NEAR)
      camera.far = parts.span * FAR_RATIO
      camera.updateProjectionMatrix()
      renderer.setSize(w, h)
      // ⚠ 取景要等真实宽高比：舞台宽了，长条形的部件才填得满，否则放大弹窗
      //   只是把黑边一起放大
      if (framing) frameBox(camera, controls, parts.box)
    },

    frame: (deltaS) => {
      if (parts.autoRotate) {
        stage.rotation.y += THREE.MathUtils.degToRad(SPIN_DEG_PER_S) * deltaS
      }
      controls.update()
      renderer.render(scene, camera)
    },

    dispose: () => {
      controls.removeEventListener('start', releaseFraming)
      controls.dispose()
      // ⚠ 只收自己造的灯：几何与材质是与主场景共用的，在这里 dispose 会让
      //   大屏上那个部件整块消失
      lighting.traverse((node) => {
        if (node instanceof THREE.Light) node.dispose()
      })
      scene.clear()
      canvas.remove()
      renderer.dispose()
      renderer.forceContextLoss()
    },
  }
}
