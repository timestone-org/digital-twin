/**
 * @fileoverview 孪生编辑视口的命令式内核：装配场景、装载模型、维护拾取与选中高亮，
 * 并把「选中了什么 / 点中了哪个节点 / 相机停在哪」回调给宿主组件。纯 TS，不依赖 Vue。
 *
 * ⚠ 与运行态渲染器（`TwinScene`）刻意不同的四处，理由都写在各自落点上：
 * 只认 `visibility.visible`、地面网格恒显、自动旋转恒关、覆盖层实时值一律喂空。
 */
import type { TwinConfig, Vec3 } from '@dt/twin-config'
import {
  DEFAULT_CAMERA_FOV,
  EMPTY_ANCHOR_VALUES,
  EMPTY_ARROW_VALUES,
  EMPTY_FLOW_VALUES,
  EMPTY_PANEL_VALUES,
} from '@dt/twin-config'
import * as THREE from 'three'

import { createFrameClock } from './frameClock'
import { resolveTwinModelUrl } from './host'
import { createGltfSource, loadTwinModel, type GltfSource } from './modelLoader'
import {
  EMPTY_NODE_INDEX,
  applyPartVisibility,
  buildNodeIndex,
  objectsOfNames,
  type NodeIndex,
} from './nodeIndex'
import {
  PickTargets,
  entityPickPoints,
  isSameSceneSelection,
  isVisibleInTree,
  ndcFromClient,
  nearestNamedName,
  partIdOfObject,
  type TwinSceneSelection,
} from './pickTargets'
import {
  WEBGL_UNAVAILABLE_MESSAGE,
  applyModelPlacement,
  boundingDiagonal,
  createSceneCore,
  createWebGLRenderer,
  disposeScene,
  disposeSceneGraph,
  frameObject,
  renderScene,
  resizeScene,
  type SceneCore,
  type SceneRendererFactory,
} from './sceneCore'
import { SceneLayers, type SceneLayerValues } from './sceneLayers'
import { ACCENT_COLOR_TOKEN, resolveColorSpec } from './themeColor'

/** 视口自己的状态机；宿主据此画空态 / 加载 / 出错的覆盖层。 */
export type EditorSceneStatus = 'empty' | 'loading' | 'ready' | 'error'

/** 拾取模式。null = 普通浏览，点选实体。 */
export type TwinPickMode = 'node' | 'position' | null

/** 一个机位快照。 */
export interface TwinCameraPose {
  position: Vec3
  target: Vec3
  fov: number
}

/** 视口向宿主回传的六件事，与组件的 emits 一一对应。 */
export interface EditorSceneCallbacks {
  select: (selection: TwinSceneSelection | null) => void
  pickNode: (nodeName: string) => void
  pickPosition: (position: Vec3) => void
  modelNodes: (names: readonly string[]) => void
  cameraChange: (pose: TwinCameraPose) => void
  status: (status: EditorSceneStatus, message: string) => void
}

export interface EditorSceneOptions {
  /** canvas、标签层与覆盖层共用的宿主元素。 */
  container: HTMLElement
  /** ⚠ 必须是 `normalizeTwinConfig` 的输出：`setConfig` 按引用比对，就地改字段不会重绘。 */
  config: TwinConfig
  on: EditorSceneCallbacks
  /** 渲染器工厂；缺省是真 WebGL 渲染器，测试传 headless 替身。 */
  createRenderer?: SceneRendererFactory
  /** 模型装载器；缺省是真 `GLTFLoader`。 */
  gltfSource?: GltfSource
}

/** 位移超过它就算拖拽而不是点击，像素 */
const CLICK_DRAG_THRESHOLD_PX = 5
const GRID_SIZE = 10
const GRID_DIVISIONS = 10
const MIN_HELPER_SCALE = 0.05
const MAX_HELPER_SCALE = 200
/** 选中框压在模型之上、拾取标记之下 */
const SELECTION_RENDER_ORDER = 970
/** token 取不出时的选中框兜底色 */
const SELECT_BOX_FALLBACK = '#7ef9ff'
/** 取景量具的最小边长，缩放为 0 会让包围盒退化成一个点 */
const MIN_PROXY_SIZE = 1e-4
/** 单个实体取景时取景框的边长，相对模型体量 */
const ENTITY_FOCUS_RATIO = 0.12
const MIN_ENTITY_SPAN = 1
/** 没命中模型时位置拾取落在这张地面上 */
const GROUND_PLANE = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)

// ⚠ 编辑器不接数据源，五路实时值恒空：读数位置显示占位符，而不是拿旧值冒充
const EMPTY_LAYER_VALUES: SceneLayerValues = {
  anchors: EMPTY_ANCHOR_VALUES,
  arrows: EMPTY_ARROW_VALUES,
  panels: EMPTY_PANEL_VALUES,
  flows: EMPTY_FLOW_VALUES,
}

/**
 * 地面网格与坐标轴。
 * ⚠ 恒显，不看 `model.showGroundGrid`：那个开关说的是大屏上要不要画，
 * 而编辑时没有参考系就没法摆坐标。
 */
function createHelpers(): THREE.Group {
  const group = new THREE.Group()
  group.name = 'twin-editor-helpers'
  group.add(
    new THREE.GridHelper(GRID_SIZE, GRID_DIVISIONS),
    new THREE.AxesHelper(GRID_SIZE / 2),
  )
  return group
}

/**
 * 网格随模型体量缩放；模型缺席或体量取不到时按 1 倍。
 * @param span 模型包围盒对角线长度
 */
function helperScaleFor(span: number): number {
  if (!Number.isFinite(span) || span <= 0) return 1
  return Math.min(
    MAX_HELPER_SCALE,
    Math.max(MIN_HELPER_SCALE, span / GRID_SIZE),
  )
}

/**
 * 选中部件的描边框。⚠ 必须关掉深度测试，否则框被模型自己挡住，选中了却看不见。
 * @param box 描边框跟随的包围盒，`Box3Helper` 按引用持有它
 * @param host 读 CSS 变量级联的宿主元素
 */
function createSelectionBox(
  box: THREE.Box3,
  host: HTMLElement | null,
): THREE.Box3Helper {
  const color =
    resolveColorSpec(ACCENT_COLOR_TOKEN, host) ??
    new THREE.Color(SELECT_BOX_FALLBACK)
  const helper = new THREE.Box3Helper(box, color)
  helper.name = 'twin-selection-box'
  helper.renderOrder = SELECTION_RENDER_ORDER
  helper.visible = false
  if (helper.material instanceof THREE.Material) {
    helper.material.depthTest = false
  }
  return helper
}

/**
 * 取景量具：一个不可见的单位立方体。
 * ⚠ `frameObject` 只收对象，而部件与实体的取景目标是一个包围盒；借它把两者接上，
 * 取景的算法就仍然只有 `sceneCore` 那一份。
 */
function createFocusProxy(): THREE.Mesh {
  const proxy = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1))
  proxy.name = 'twin-focus-proxy'
  proxy.visible = false
  return proxy
}

/** 一个编辑态视口。宿主挂载时建一份，卸载时 `dispose`。 */
export class EditorScene {
  private readonly container: HTMLElement
  private readonly on: EditorSceneCallbacks
  private readonly gltfSource: GltfSource
  private readonly raycaster = new THREE.Raycaster()
  private readonly clock = createFrameClock()
  /** 选中框跟随的包围盒；`Box3Helper` 按引用持有，只能往里 `copy` 不能换对象。 */
  private readonly selectionBoxTarget = new THREE.Box3()

  private config: TwinConfig
  private core: SceneCore | null = null
  private layers: SceneLayers | null = null
  private picks: PickTargets | null = null
  private helpers: THREE.Group | null = null
  private selectionBox: THREE.Box3Helper | null = null
  private focusProxy: THREE.Mesh | null = null
  private modelObject: THREE.Object3D | null = null
  private nodeIndex: NodeIndex = EMPTY_NODE_INDEX
  private observer: ResizeObserver | null = null
  private surface: HTMLElement | null = null
  private selection: TwinSceneSelection | null = null
  private pickMode: TwinPickMode = null
  private frameHandle = 0
  private loadSeq = 0
  private loadAbort: AbortController | null = null
  private modelSpan = 0
  private downX = 0
  private downY = 0
  private downValid = false

  constructor(options: EditorSceneOptions) {
    this.container = options.container
    this.on = options.on
    this.config = options.config
    this.gltfSource = options.gltfSource ?? createGltfSource()
    this.mount(options.createRenderer ?? createWebGLRenderer)
  }

  /**
   * 换一份配置；只有模型引用变了才重新装载。
   * @param config 归一化后的孪生配置
   */
  setConfig(config: TwinConfig): void {
    if (config === this.config) return
    const changedAsset = config.model.asset !== this.config.model.asset
    this.config = config
    // ⚠ 无论换不换模型都先刷一遍：换模型那条路上装载可能失败，只等 `mountModel`
    // 去刷的话，覆盖层与拾取标记会一直停在上一份配置上
    this.refresh()
    if (changedAsset) void this.load()
  }

  /**
   * 换选中态。
   * @param selection 当前选中，null = 没有
   */
  setSelection(selection: TwinSceneSelection | null): void {
    if (isSameSceneSelection(selection, this.selection)) return
    this.selection = selection
    this.applySelectionHighlight()
  }

  /**
   * 切拾取模式，顺带换光标，让人看得出「现在这一下点的是位置不是实体」。
   * @param mode 'node' 点部件节点 / 'position' 点世界坐标 / null 普通浏览
   */
  setPickMode(mode: TwinPickMode): void {
    this.pickMode = mode
    this.container.style.cursor = mode === null ? '' : 'crosshair'
  }

  /**
   * 把镜头飞到某个实体或部件上；视点直接套用它存下的机位。
   * @param selection 要对焦的目标
   */
  focus(selection: TwinSceneSelection): void {
    if (selection.kind === 'cameras') {
      this.applyCamera(selection.id)
      return
    }
    const box = this.boxOfSelection(selection)
    if (box !== null) this.frameBox(box)
  }

  /** 当前机位快照；场景没装配起来时给一份中性缺省值。 */
  snapshot(): TwinCameraPose {
    const core = this.core
    if (core === null) {
      return { position: [0, 0, 0], target: [0, 0, 0], fov: DEFAULT_CAMERA_FOV }
    }
    const eye = core.camera.position
    const target = core.controls.target
    return {
      position: [eye.x, eye.y, eye.z],
      target: [target.x, target.y, target.z],
      fov: core.camera.fov,
    }
  }

  /** 卸载收口：在途装载、rAF、Observer、监听与全部 three 资源逐个释放。 */
  dispose(): void {
    // ⚠ 先让在途装载作废再释放：晚一步回来的那次会往已 dispose 的场景里挂模型
    this.loadSeq += 1
    this.loadAbort?.abort()
    this.loadAbort = null
    cancelAnimationFrame(this.frameHandle)
    this.frameHandle = 0
    this.observer?.disconnect()
    this.observer = null
    this.detach()
    this.layers?.dispose()
    this.layers = null
    this.picks?.dispose()
    this.picks = null
    if (this.core !== null) disposeScene(this.core)
    this.core = null
    this.modelObject = null
    this.helpers = null
    this.selectionBox = null
    this.focusProxy = null
    this.nodeIndex = EMPTY_NODE_INDEX
  }

  private mount(factory: SceneRendererFactory): void {
    const renderer = factory()
    if (renderer === null) {
      this.fail(WEBGL_UNAVAILABLE_MESSAGE)
      return
    }
    const core = createSceneCore({ container: this.container, renderer })
    // ⚠ 编辑视口恒关自动旋转：一边转一边填坐标是没法用的
    core.controls.autoRotate = false
    this.core = core
    const layers = new SceneLayers(this.container)
    layers.addTo(core.scene)
    this.layers = layers
    this.picks = new PickTargets(this.container)
    this.helpers = createHelpers()
    this.selectionBox = createSelectionBox(
      this.selectionBoxTarget,
      this.container,
    )
    this.focusProxy = createFocusProxy()
    core.scene.add(
      this.picks.group,
      this.helpers,
      this.selectionBox,
      this.focusProxy,
    )
    this.attach(core)
    this.measure()
    this.refresh()
    this.clock.reset()
    this.frameHandle = requestAnimationFrame(this.tick)
    void this.load()
  }

  private attach(core: SceneCore): void {
    const surface = core.renderer.domElement
    this.surface = surface
    surface.addEventListener('pointerdown', this.onPointerDown)
    surface.addEventListener('pointerup', this.onPointerUp)
    surface.addEventListener('pointercancel', this.onPointerCancel)
    core.controls.addEventListener('end', this.onControlsEnd)
    this.observer = new ResizeObserver(this.measure)
    this.observer.observe(this.container)
  }

  private detach(): void {
    const surface = this.surface
    if (surface !== null) {
      surface.removeEventListener('pointerdown', this.onPointerDown)
      surface.removeEventListener('pointerup', this.onPointerUp)
      surface.removeEventListener('pointercancel', this.onPointerCancel)
    }
    this.core?.controls.removeEventListener('end', this.onControlsEnd)
    this.surface = null
  }

  /** 配置变了要重走的四件事：摆放、部件显隐、覆盖层与拾取标记、选中高亮。 */
  private refresh(): void {
    if (this.core === null) return
    this.placeModel()
    // ⚠ 只认作者直接置的 `visible`，不套任何距离派生的显隐：编辑时镜头到处飞，
    // 套上规则会让人「刚配好的东西一转镜头就不见了」
    applyPartVisibility(this.nodeIndex, this.config.parts)
    this.layers?.build(this.config, EMPTY_LAYER_VALUES)
    this.picks?.build(this.config)
    this.applySelectionHighlight()
  }

  /** 把配置里的摆放落到模型上，并按新体量重算覆盖层与网格的尺寸。 */
  private placeModel(): void {
    if (this.modelObject === null) return
    applyModelPlacement(this.modelObject, this.config.model)
    this.modelSpan = boundingDiagonal(this.modelObject)
    this.layers?.setWorldScale(this.modelSpan)
    this.helpers?.scale.setScalar(helperScaleFor(this.modelSpan))
  }

  /** 选中反馈：部件画描边框，其余四类把自己的拾取标记放大加亮。 */
  private applySelectionHighlight(): void {
    this.picks?.setSelected(this.selection)
    const helper = this.selectionBox
    if (helper === null) return
    const box =
      this.selection?.kind === 'parts'
        ? this.boxOfPart(this.selection.id)
        : null
    if (box === null) {
      helper.visible = false
      return
    }
    this.selectionBoxTarget.copy(box)
    helper.visible = true
    helper.updateMatrixWorld(true)
  }

  private boxOfSelection(selection: TwinSceneSelection): THREE.Box3 | null {
    if (selection.kind === 'parts') return this.boxOfPart(selection.id)
    if (selection.kind === 'model' || selection.kind === 'viewpoints') {
      return this.modelObject === null
        ? null
        : new THREE.Box3().setFromObject(this.modelObject)
    }
    const point = entityPickPoints(this.config).find(
      (item) => item.kind === selection.kind && item.id === selection.id,
    )
    if (point === undefined) return null
    const span = Math.max(this.modelSpan * ENTITY_FOCUS_RATIO, MIN_ENTITY_SPAN)
    return new THREE.Box3().setFromCenterAndSize(
      new THREE.Vector3(...point.position),
      new THREE.Vector3(span, span, span),
    )
  }

  private boxOfPart(id: string): THREE.Box3 | null {
    const part = this.config.parts.find((item) => item.id === id)
    if (part === undefined) return null
    const box = new THREE.Box3()
    for (const object of objectsOfNames(this.nodeIndex, part.nodes)) {
      box.expandByObject(object)
    }
    return box.isEmpty() ? null : box
  }

  private frameBox(box: THREE.Box3): void {
    const core = this.core
    const proxy = this.focusProxy
    if (core === null || proxy === null || box.isEmpty()) return
    box.getCenter(proxy.position)
    box.getSize(proxy.scale)
    proxy.scale.set(
      Math.max(proxy.scale.x, MIN_PROXY_SIZE),
      Math.max(proxy.scale.y, MIN_PROXY_SIZE),
      Math.max(proxy.scale.z, MIN_PROXY_SIZE),
    )
    proxy.updateMatrixWorld(true)
    frameObject(core, proxy)
    this.emitCamera()
  }

  private applyCamera(id: string): void {
    const core = this.core
    const camera = this.config.cameras.find((item) => item.id === id)
    if (core === null || camera === undefined) return
    core.camera.position.set(...camera.position)
    core.camera.fov = camera.fov
    core.camera.updateProjectionMatrix()
    core.controls.target.set(...camera.target)
    core.controls.update()
    this.emitCamera()
  }

  private emitCamera(): void {
    this.on.cameraChange(this.snapshot())
  }

  private async load(): Promise<void> {
    const mine = ++this.loadSeq
    this.loadAbort?.abort()
    const controller = new AbortController()
    this.loadAbort = controller
    const asset = this.config.model.asset
    if (asset === '') {
      this.clearModel()
      this.on.modelNodes([])
      this.on.status('empty', '')
      return
    }
    const url = resolveTwinModelUrl(asset)
    if (url === '') {
      this.fail('模型地址解析失败：素材引用无效或宿主未注入')
      return
    }
    this.on.status('loading', '')
    try {
      const root = await loadTwinModel(
        url,
        { signal: controller.signal },
        this.gltfSource,
      )
      // ⚠ 慢的那次后返回时要连同它的 GPU 资源一起丢掉：只 return 是一次纯泄漏
      if (mine !== this.loadSeq) {
        disposeSceneGraph(root)
        return
      }
      this.mountModel(root)
    } catch (error) {
      if (mine !== this.loadSeq) return
      this.fail(error instanceof Error ? error.message : '模型加载失败')
    }
  }

  private mountModel(root: THREE.Object3D): void {
    const core = this.core
    if (core === null) {
      disposeSceneGraph(root)
      return
    }
    this.clearModel()
    this.modelObject = root
    core.modelRoot.add(root)
    this.nodeIndex = buildNodeIndex(root)
    this.refresh()
    frameObject(core, root)
    this.on.modelNodes(this.nodeIndex.namedNodes)
    this.on.status('ready', '')
    this.emitCamera()
  }

  /** 卸掉当前模型并释放它的 GPU 资源；索引、体量与选中框一并归零。 */
  private clearModel(): void {
    if (this.core !== null) disposeSceneGraph(this.core.modelRoot)
    this.modelObject = null
    this.nodeIndex = EMPTY_NODE_INDEX
    this.modelSpan = 0
    this.helpers?.scale.setScalar(1)
    this.applySelectionHighlight()
  }

  private fail(message: string): void {
    this.clearModel()
    // 模型没了，节点清单也要跟着空掉，否则部件检查器还在拿上一个模型的节点名挑选
    this.on.modelNodes([])
    this.on.status('error', message)
  }

  private readonly tick = (now: number): void => {
    const core = this.core
    if (core === null) return
    const delta = this.clock.tick(now)
    if (delta > 0) this.layers?.update(delta)
    // ⚠ 宿主被折叠（clientHeight 为 0）时不换算标记尺寸：拿 0 当视口高度算出来的
    // 世界尺寸会把相机整个包进标记球里，之后连点都点不中，而画面上什么异常都看不出
    const height = this.container.clientHeight
    if (height > 0) this.picks?.updateForCamera(core.camera, height)
    renderScene(core)
    this.frameHandle = requestAnimationFrame(this.tick)
  }

  private readonly measure = (): void => {
    if (this.core === null) return
    resizeScene(
      this.core,
      this.container.clientWidth,
      this.container.clientHeight,
    )
  }

  private readonly onControlsEnd = (): void => {
    this.emitCamera()
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    this.downValid = event.button === 0
    this.downX = event.clientX
    this.downY = event.clientY
  }

  // ⚠ 拖过视口不算点击：轨道相机的拖拽同样以 pointerup 收尾，不设位移阈值的话
  // 每次转镜头松手都会顺手把选中改掉
  private readonly onPointerUp = (event: PointerEvent): void => {
    if (!this.downValid || event.button !== 0) return
    this.downValid = false
    const moved = Math.hypot(
      event.clientX - this.downX,
      event.clientY - this.downY,
    )
    if (moved > CLICK_DRAG_THRESHOLD_PX) return
    this.handleClick(event.clientX, event.clientY)
  }

  private readonly onPointerCancel = (): void => {
    this.downValid = false
  }

  private handleClick(clientX: number, clientY: number): void {
    const core = this.core
    if (core === null) return
    const rect = core.renderer.domElement.getBoundingClientRect()
    const ndc = ndcFromClient(rect, clientX, clientY)
    if (ndc === null) return
    // ⚠ 射线读的是 matrixWorld，而它只在渲染那一刻才刷新：程序化移完镜头立刻点一下，
    // 用的就是上一帧的位姿，命中结果整片偏掉且看不出原因
    core.camera.updateMatrixWorld()
    this.modelObject?.updateMatrixWorld(true)
    this.raycaster.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), core.camera)
    if (this.pickMode === 'node') return this.pickNode()
    if (this.pickMode === 'position') return this.pickPosition()
    this.pickEntity()
  }

  /** 部件检查器的「从模型里点一个节点」。 */
  private pickNode(): void {
    const hit = this.firstModelHit()
    if (hit === null) return
    const name = nearestNamedName(hit.object)
    if (name !== '') this.on.pickNode(name)
  }

  /**
   * 位置拾取：优先取模型表面的命中点。
   * ⚠ 没命中模型时落到 y=0 的地面上而不是什么都不给——模型还没挑好时也要能摆锚点。
   */
  private pickPosition(): void {
    const hit = this.firstModelHit()
    if (hit !== null) {
      this.on.pickPosition([hit.point.x, hit.point.y, hit.point.z])
      return
    }
    const point = new THREE.Vector3()
    if (this.raycaster.ray.intersectPlane(GROUND_PLANE, point) === null) return
    this.on.pickPosition([point.x, point.y, point.z])
  }

  /** 普通浏览态的点选：拾取标记优先，其次落到部件，都没命中就是点了空白。 */
  private pickEntity(): void {
    const marker = this.picks?.raycast(this.raycaster) ?? null
    if (marker !== null) {
      this.on.select(marker)
      return
    }
    const hit = this.firstModelHit()
    const partId =
      hit === null ? '' : partIdOfObject(hit.object, this.config.parts)
    this.on.select(partId === '' ? null : { kind: 'parts', id: partId })
  }

  // ⚠ three 的射线根本不看可见性，隐藏部件照样会命中，只能自己上溯祖先链判
  private firstModelHit(): THREE.Intersection | null {
    const model = this.modelObject
    if (model === null) return null
    return (
      this.raycaster
        .intersectObject(model, true)
        .find((hit) => isVisibleInTree(hit.object)) ?? null
    )
  }
}
