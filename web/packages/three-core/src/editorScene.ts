/**
 * @fileoverview 孪生编辑视口的命令式内核：装配场景、装载模型、维护拾取与选中高亮，
 * 并把「选中了什么 / 点中了哪个节点 / 相机停在哪」回调给宿主组件。纯 TS，不依赖 Vue。
 *
 * ⚠ 与运行态渲染器（`TwinScene`）刻意不同的三处，理由都写在各自落点上：
 * 只认 `visibility.visible`、自动旋转恒关、
 * 漫游只在用户点「预览」时才飞（绝不自动开播）。
 * 实时值由宿主 `setValues` 喂进来，没喂就是一片占位符——绝不拿旧值冒充。
 */
import type {
  TwinConfig,
  TwinDistanceRef,
  TwinPose,
  Vec3,
} from '@dt/twin-config'
import {
  DEFAULT_CAMERA_FOV,
  EMPTY_ANCHOR_VALUES,
  EMPTY_ARROW_VALUES,
  EMPTY_FLOW_VALUES,
  EMPTY_PANEL_VALUES,
  EMPTY_PART_VALUES,
  RoamTimeline,
  buildRoamSegments,
  defaultCameraOf,
  gizmoTargetOf,
  sameVec3,
} from '@dt/twin-config'
import * as THREE from 'three'

import { flowMidpointOf, panelPositionOf } from './distanceBasis'
import { distanceContextOf, distanceResolver } from './distanceContext'
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
  applyCameraPose,
  applyModelPlacement,
  boundingDiagonal,
  createSceneCore,
  createWebGLRenderer,
  disposeScene,
  disposeSceneGraph,
  frameBoxPose,
  frameObject,
  modelFrameOrigin,
  renderScene,
  resizeScene,
  type SceneCore,
  type SceneRendererFactory,
} from './sceneCore'
import { createCameraFlight } from './cameraFlight'
import { MarqueeGesture } from './marqueeGesture'
import { nodeNamesInRect, type ScreenRect } from './marqueeSelect'
import { SceneLayers, type SceneLayerValues } from './sceneLayers'
import {
  TransformGizmo,
  type GizmoChange,
  type GizmoMode,
} from './transformGizmo'
import { ACCENT_COLOR_TOKEN, resolveColorSpec } from './themeColor'

/**
 * 一串带 id 与坐标的实体里，指定那一个的坐标；没有这一个给 null。
 * @param list 锚点或箭头
 * @param id 实体 id
 */
function positionById(
  list: readonly { id: string; position: Vec3 }[],
  id: string,
): Vec3 | null {
  return list.find((item) => item.id === id)?.position ?? null
}

/** 视口自己的状态机；宿主据此画空态 / 加载 / 出错的覆盖层。 */
export type EditorSceneStatus = 'empty' | 'loading' | 'ready' | 'error'

/** 拾取模式。null = 普通浏览，点选实体。 */
export type TwinPickMode = 'node' | 'position' | null

/** 一个机位快照；与漫游插值用的位姿是同一样东西，两份声明必然漂。 */
export type TwinCameraPose = TwinPose

/** 视口向宿主回传的七件事，与组件的 emits 一一对应。 */
export interface EditorSceneCallbacks {
  select: (selection: TwinSceneSelection | null) => void
  pickNode: (nodeName: string) => void
  pickPosition: (position: Vec3) => void
  modelNodes: (names: readonly string[]) => void
  cameraChange: (pose: TwinCameraPose) => void
  status: (status: EditorSceneStatus, message: string) => void
  /**
   * 当前坐标基准的原点（世界坐标）变了。
   * ⚠ 宿主必须拿它换算右栏那几个坐标框：不换算的话，选了「模型中心」之后
   * 视口里的参考轴已经挪到中心、输入框里却还是世界坐标，两处对不上且都不报错。
   */
  frameOrigin: (origin: Vec3) => void
  /** 漫游预览的开停；用户一碰镜头它会自己停，面板上的按钮要跟着回落。 */
  roamPreview: (playing: boolean) => void
  /**
   * 用户拖坐标轴手柄改了某个实体的位置 / 朝向。
   * ⚠ 拖动期间持续回传，宿主要按「一次拖动一条撤销」去合并，
   * 逐帧各记一条的话撤销一次只退回一帧。
   */
  entityTransform: (change: GizmoChange) => void
  /** 手柄松手了；宿主据此把这一次拖动合成一条撤销。 */
  entityTransformEnd: () => void
  /** 选中部件后按住 Shift 点选或框选拿到的模型节点名；一个都没命中时不来。 */
  marqueeNodes: (names: readonly string[]) => void
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
/** 帧钟给的是秒，漫游时间线收的是毫秒 */
const MS_PER_S = 1000
const GRID_SIZE = 10
const GRID_DIVISIONS = 10
const MIN_HELPER_SCALE = 0.05
const MAX_HELPER_SCALE = 200
/** 选中框压在模型之上、拾取标记之下 */
const SELECTION_RENDER_ORDER = 970
/** token 取不出时的选中框兜底色 */
const SELECT_BOX_FALLBACK = '#7ef9ff'
/** 单个实体取景时取景框的边长，相对模型体量 */
const ENTITY_FOCUS_RATIO = 0.12
const MIN_ENTITY_SPAN = 1
/** 地面的法向；位置拾取用它按基准原点的高度现搭一张平面 */
const GROUND_NORMAL = new THREE.Vector3(0, 1, 0)

// 宿主没喂实时值时的那一份：读数位置显示占位符，而不是拿旧值冒充
const EMPTY_LAYER_VALUES: SceneLayerValues = {
  parts: EMPTY_PART_VALUES,
  anchors: EMPTY_ANCHOR_VALUES,
  arrows: EMPTY_ARROW_VALUES,
  panels: EMPTY_PANEL_VALUES,
  flows: EMPTY_FLOW_VALUES,
}

/**
 * 地面网格与坐标轴；显隐认 `model.showGroundGrid`，与大屏是同一个开关。
 * ⚠ 关掉之后编辑时就没有参考系了，摆坐标只能照着模型自己找位置。
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
  /** 宿主最近一次喂进来的五路实时值；重建覆盖层时按它重放。 */
  private liveValues: SceneLayerValues = EMPTY_LAYER_VALUES
  private core: SceneCore | null = null
  private layers: SceneLayers | null = null
  private picks: PickTargets | null = null
  private helpers: THREE.Group | null = null
  private selectionBox: THREE.Box3Helper | null = null
  private gizmo: TransformGizmo | null = null
  private gizmoMode: GizmoMode = 'translate'
  private marquee: MarqueeGesture | null = null
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
  /** 当前基准原点（世界坐标）；变了才回调，免得每帧白发一次。 */
  private coordOrigin: Vec3 = [0, 0, 0]
  private downX = 0
  private downY = 0
  private downValid = false
  /** 这次按下是否由“当前部件追加节点”接管；用于区分小框与 Shift 单击。 */
  private shiftSelectingPartNodes = false
  /** 漫游预览的时间线；没在预览时是 null，编辑态绝不自己造一条开播。 */
  private roam: RoamTimeline | null = null
  /** 聚焦与切视点共用的一段相机飞行；用户一碰视口就取消。 */
  private readonly flight = createCameraFlight()

  constructor(options: EditorSceneOptions) {
    this.container = options.container
    this.on = options.on
    this.config = options.config
    this.gltfSource = options.gltfSource ?? createGltfSource()
    this.mount(options.createRenderer ?? createWebGLRenderer)
  }

  /**
   * 换一份配置；只有模型引用或压缩档变了才重新装载。
   * @param config 归一化后的孪生配置
   */
  setConfig(config: TwinConfig): void {
    if (config === this.config) return
    const changedModel =
      config.model.asset !== this.config.model.asset ||
      config.model.variant !== this.config.model.variant
    this.config = config
    // ⚠ 无论换不换模型都先刷一遍：换模型那条路上装载可能失败，只等 `mountModel`
    // 去刷的话，覆盖层与拾取标记会一直停在上一份配置上
    this.refresh()
    if (changedModel) void this.load()
  }

  /**
   * 换一份实时值，只换值不重建覆盖层。
   * ⚠ 必须记在实例上：`refresh()` 会把覆盖层整片重建，重建时不重放这一份的话，
   * 改一下配置就会把读数全刷回占位符，而下一帧数据到来之前它一直是那样。
   * @param values 缝合好的五路实时值
   */
  setValues(values: SceneLayerValues): void {
    this.liveValues = values
    this.layers?.setValues(values)
    // ⚠ 状态染色只有在这里重套一次才会跟着读数变：编辑视口不逐帧套距离规则，
    //   没有别的地方会再调它，表现就是「点位的值在变、部件的颜色不动」
    this.layers?.parts.applyAppearance()
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
    this.syncGizmo()
  }

  /**
   * 切手柄的模式；只有箭头用得上 `rotate`。
   * @param mode 平移还是旋转
   */
  setGizmoMode(mode: GizmoMode): void {
    if (mode === this.gizmoMode) return
    this.gizmoMode = mode
    this.syncGizmo()
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

  /**
   * 按参考系量一下当前相机离选中实体多远；量不出给 null。
   *
   * ⚠ 与运行态逐帧判显隐走的是同一个 `distanceResolver` 和同一组基准点：
   * 这里另算一套的话，量出来的数填回阈值就是个不生效的门槛，而它不报错。
   * ⚠ 基准点从配置算、不问渲染层要：左栏眼睛关掉的实体在渲染层根本没有条目，
   * 问它会把「临时藏起来了」误报成「量不出」。
   *
   * @param ref 距离参考系
   */
  measureDistance(ref: TwinDistanceRef): number | null {
    const core = this.core
    if (core === null) return null
    const basis = this.distanceBasisOf(this.selection)
    const resolve = distanceResolver(
      distanceContextOf(core),
      basis.self,
      basis.partCenter,
    )
    const distance = resolve(ref)
    return distance !== null && Number.isFinite(distance) ? distance : null
  }

  /**
   * 选中实体的两个基准点：它自己在哪、它所属部件的中心在哪。
   * ⚠ 覆盖层元素不属于任何部件，`partCenter` 恒为 null——`part-center`
   * 那一档对它们本来就不成立（配了等于不限制），这里如实给 null。
   * @param selection 当前选中；null = 没选中
   */
  private distanceBasisOf(selection: TwinSceneSelection | null): {
    self: Vec3 | THREE.Vector3 | null
    partCenter: THREE.Vector3 | null
  } {
    const none = { self: null, partCenter: null }
    if (selection === null || !('id' in selection)) return none
    if (selection.kind === 'parts') {
      // 部件的 `self` 与 `part-center` 是同一个点，运行态那边也是这么给的
      const center = this.layers?.parts.centerOf(selection.id) ?? null
      return { self: center, partCenter: center }
    }
    return { self: this.entityPositionOf(selection), partCenter: null }
  }

  /**
   * 覆盖层元素套 `self` 参考系时用的那个点；定不出来给 null。
   * @param selection 当前选中的覆盖层元素
   */
  private entityPositionOf(
    selection: Extract<TwinSceneSelection, { id: string }>,
  ): Vec3 | THREE.Vector3 | null {
    const { anchors, panels, arrows, flows } = this.config
    if (selection.kind === 'anchors') return positionById(anchors, selection.id)
    if (selection.kind === 'arrows') return positionById(arrows, selection.id)
    if (selection.kind === 'panels') {
      const panel = panels.find((item) => item.id === selection.id)
      return panel === undefined ? null : panelPositionOf(panel, anchors)
    }
    if (selection.kind === 'flows') {
      const flow = flows.find((item) => item.id === selection.id)
      return flow === undefined ? null : flowMidpointOf(flow, anchors)
    }
    // 视点没有几何，离它多远无从说起
    return null
  }

  /**
   * 按当前配置飞一遍漫游轨迹，看完即停。可用视点不足两个时返回 false，
   * 宿主据此告诉用户「先去多存几个机位」。
   * ⚠ 编辑态只有这一个入口会自动移镜头：绝不跟着 `autoplay` 自己开播——
   * 配置的时候镜头一直在飘，就没法把锚点摆到位。
   */
  playRoamPreview(): boolean {
    const segments = buildRoamSegments(
      this.config.cameras,
      this.config.roamTour,
    )
    if (segments.length === 0) return false
    // 预览接管镜头：半路的飞行就地取消，免得两边同帧抢方向盘
    this.flight.cancel()
    this.roam = new RoamTimeline(segments, this.config.roamTour.loop)
    this.roam.play()
    this.on.roamPreview(true)
    return true
  }

  /** 停下预览，镜头停在当前这一帧上（幂等）。 */
  stopRoamPreview(): void {
    if (this.roam === null) return
    this.roam = null
    this.on.roamPreview(false)
  }

  /** 卸载收口：在途装载、rAF、Observer、监听与全部 three 资源逐个释放。 */
  dispose(): void {
    // ⚠ 先让在途装载作废再释放：晚一步回来的那次会往已 dispose 的场景里挂模型
    this.loadSeq += 1
    this.roam = null
    this.flight.cancel()
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
    this.gizmo?.dispose()
    this.gizmo = null
    this.marquee?.dispose()
    this.marquee = null
    if (this.core !== null) disposeScene(this.core)
    this.core = null
    this.modelObject = null
    this.helpers = null
    this.selectionBox = null
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
    this.marquee = new MarqueeGesture({
      host: () => this.container,
      onFinish: (rect) => this.finishMarquee(rect),
    })
    this.gizmo = new TransformGizmo({
      core,
      onChange: (change) => this.on.entityTransform(change),
      onDragEnd: () => this.on.entityTransformEnd(),
    })
    core.scene.add(this.picks.group, this.helpers, this.selectionBox)
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
    surface.addEventListener('pointermove', this.onPointerMove)
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
      surface.removeEventListener('pointermove', this.onPointerMove)
      surface.removeEventListener('pointerup', this.onPointerUp)
      surface.removeEventListener('pointercancel', this.onPointerCancel)
    }
    this.core?.controls.removeEventListener('end', this.onControlsEnd)
    this.surface = null
  }

  /** 配置变了要重走的五件事：摆放、参考网格、部件显隐、覆盖层与拾取标记、选中高亮。 */
  private refresh(): void {
    if (this.core === null) return
    this.placeModel()
    // 网格与坐标轴跟着「地面网格」开关走：只在大屏上生效的话，用户关掉之后
    // 编辑视口里它还在，两边画面对不上
    if (this.helpers !== null) {
      this.helpers.visible = this.config.model.showGroundGrid
    }
    // ⚠ 只认调用方传入的 `visible`，不套任何距离派生的显隐：页面会在这一层
    // 叠加左栏眼睛的编辑态覆盖，不读持久化的运行时距离规则
    applyPartVisibility(this.nodeIndex, this.config.parts)
    this.layers?.build(this.config, this.liveValues, this.nodeIndex)
    // ⚠ 只套外观、不套距离：编辑时镜头到处飞，套上距离规则会让刚配好的东西
    // 一转镜头就不见。但透明度与染色必须当场看得见，否则等于没法配
    this.layers?.parts.applyAppearance()
    this.picks?.build(this.config)
    this.applySelectionHighlight()
  }

  /** 把配置里的摆放落到模型上，并按新体量重算覆盖层与网格的尺寸。 */
  private placeModel(): void {
    if (this.modelObject !== null) {
      applyModelPlacement(this.modelObject, this.config.model)
      this.modelSpan = boundingDiagonal(this.modelObject)
      this.layers?.setWorldScale(this.modelSpan)
      this.helpers?.scale.setScalar(helperScaleFor(this.modelSpan))
    }
    // ⚠ 基准那一支不跟着「有没有模型」早退：没挑模型时参考轴也要立在基准原点上，
    // 且右栏在那一刻就得拿到原点，否则第一个锚点是照着世界坐标摆的
    this.syncFrame()
  }

  /**
   * 把网格与坐标轴挪到当前基准的原点上，并把原点告诉宿主。
   * ⚠ 全场只有这一处在算基准原点：右栏输入框的读数与视口里这三条轴必须同源，
   * 各算一份的话「输入框里的 0」与「轴的交点」会是两个地方。
   */
  private syncFrame(): void {
    const origin = modelFrameOrigin(this.config.model, this.modelObject)
    this.helpers?.position.set(...origin)
    this.layers?.setFrameOrigin(origin)
    if (sameVec3(origin, this.coordOrigin)) return
    this.coordOrigin = origin
    this.on.frameOrigin(origin)
  }

  /** 选中反馈：部件画描边框，其余四类把自己的拾取标记放大加亮。 */
  private applySelectionHighlight(): void {
    this.picks?.setSelected(this.selection)
    this.syncGizmo()
    const helper = this.selectionBox
    if (helper === null) return
    const box =
      this.selection === null ? null : this.boxOfHighlight(this.selection)
    if (box === null) {
      helper.visible = false
      return
    }
    this.selectionBoxTarget.copy(box)
    helper.visible = true
    helper.updateMatrixWorld(true)
  }

  /**
   * 把手柄挂到当前选中的实体上；不该有手柄的一律收起。
   * ⚠ 拾取模式下收起：那时用户点的是「一个位置」或「一个节点」，
   * 摆着手柄会挡住要点的东西，且两套交互抢同一个指针。
   */
  private syncGizmo(): void {
    const gizmo = this.gizmo
    if (gizmo === null) return
    if (this.pickMode !== null) return gizmo.detach()
    const target = gizmoTargetOf(this.config, this.selection)
    gizmo.attach(target, this.gizmoMode)
  }

  /** 选中框只画在有几何的那一类上：部件。 */
  private boxOfHighlight(selection: TwinSceneSelection): THREE.Box3 | null {
    if (selection.kind === 'parts') return this.boxOfPart(selection.id)
    return null
  }

  private boxOfSelection(selection: TwinSceneSelection): THREE.Box3 | null {
    if (selection.kind === 'parts') return this.boxOfPart(selection.id)
    // 三个单例段没有自己的几何，取景一律退回整个模型
    if (
      selection.kind === 'model' ||
      selection.kind === 'viewpoints' ||
      selection.kind === 'roam'
    ) {
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
    return this.boxOfNames(part.nodes)
  }

  /** 一组模型节点名的包围盒；一个都没命中给 null。 */
  private boxOfNames(names: readonly string[]): THREE.Box3 | null {
    const box = new THREE.Box3()
    for (const object of objectsOfNames(this.nodeIndex, names)) {
      box.expandByObject(object)
    }
    return box.isEmpty() ? null : box
  }

  private frameBox(box: THREE.Box3): void {
    const core = this.core
    if (core === null) return
    const framed = frameBoxPose(core.camera, box)
    if (framed === null) return
    this.stopRoamPreview()
    this.flight.flyTo(core, framed.pose, framed.span)
    // 飞行是异步落位，这里直接把终点位姿报给宿主，不等镜头到站
    this.on.cameraChange(framed.pose)
  }

  private applyCamera(id: string): void {
    const core = this.core
    const camera = this.config.cameras.find((item) => item.id === id)
    if (core === null || camera === undefined) return
    this.stopRoamPreview()
    this.flight.flyTo(core, camera, this.modelSpan)
    // 飞行是异步落位，这里直接把终点位姿报给宿主，不等镜头到站
    this.on.cameraChange({
      position: camera.position,
      target: camera.target,
      fov: camera.fov,
    })
  }

  /** 预览这一帧：把时间线算出的位姿落到相机上；走完了就自己收尾。 */
  private advanceRoam(deltaMs: number, core: SceneCore): void {
    const timeline = this.roam
    if (timeline === null) return
    const pose: TwinPose | null = timeline.advance(deltaMs)
    if (pose !== null) applyCameraPose(core, pose, this.modelSpan)
    if (!timeline.isPlaying) this.stopRoamPreview()
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
    const url = resolveTwinModelUrl(asset, this.config.model.variant)
    if (url === '') {
      this.fail('模型地址解析失败：素材引用无效或宿主未注入')
      return
    }
    this.on.status('loading', '')
    try {
      // 编辑视口不播模型内置动画：镜头与配置一直在动，再叠一层自走的动画
      // 只会让「我刚改的东西生效了吗」变得看不出来
      const { root } = await loadTwinModel(
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

  /**
   * 装载后的初始取景，与运行态走同一条路：有视点就用标了默认的那个，
   * 一个都没配才把整个模型框进画面。
   * ⚠ 两边必须一致：编辑器恒自动取景、运行态用默认视点的话，镜头距离不同，
   * 同一张信息牌在两边看起来一大一小——用户会以为是牌的尺寸配错了。
   */
  private applyInitialPose(root: THREE.Object3D): void {
    const core = this.core
    if (core === null) return
    const camera = defaultCameraOf(this.config.cameras)
    if (camera === null) {
      frameObject(core, root)
      return
    }
    applyCameraPose(core, camera, this.modelSpan)
    core.controls.update()
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
    this.applyInitialPose(root)
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
    this.syncFrame()
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
    // ⚠ 时长为 0 也要走：信息牌的朝向在这一支里摆，只在 delta > 0 时调的话
    // 刚建完那一帧的牌是歪的
    this.layers?.update(delta, core.camera)
    // ⚠ 喂帧钟夹过的时长：标签页切走再回来那一帧有几十秒，直接算下去预览会一帧飞完
    this.advanceRoam(delta * MS_PER_S, core)
    this.flight.advance(delta * MS_PER_S)
    // ⚠ 宿主被折叠（clientHeight 为 0）时不换算标记尺寸：拿 0 当视口高度算出来的
    // 世界尺寸会把相机整个包进标记球里，之后连点都点不中，而画面上什么异常都看不出
    const height = this.container.clientHeight
    if (height > 0) this.picks?.updateForCamera(core.camera, height)
    renderScene(core, this.layers?.root ?? null)
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
    // ⚠ 用户一碰视口就停预览、停飞行：镜头还自己往前飞会变成两个人抢方向盘
    this.stopRoamPreview()
    this.flight.cancel()
    this.shiftSelectingPartNodes = false
    // 只有左侧已经选中部件时 Shift 才接管。否则 Shift 仍留给普通视口操作，
    // 不能平白画出一个最终也不知道该写回哪个部件的框。
    if (this.canShiftSelectPartNodes() && this.marquee?.down(event) === true) {
      this.shiftSelectingPartNodes = true
      this.setOrbitEnabled(false)
      // 小于框选阈值时要回落成 Shift 单击，所以仍需保留这一组按下坐标。
      this.downValid = true
      this.downX = event.clientX
      this.downY = event.clientY
      return
    }
    this.downValid = event.button === 0
    this.downX = event.clientX
    this.downY = event.clientY
  }

  private readonly onPointerMove = (event: PointerEvent): void => {
    this.marquee?.move(event)
  }

  /** 框选期间关掉轨道控制；两套操作抢同一个指针时框会画不出来。 */
  private setOrbitEnabled(enabled: boolean): void {
    if (this.core !== null) this.core.controls.enabled = enabled
  }

  /** 框完了：算出框中哪些节点，交给宿主。 */
  private finishMarquee(rect: ScreenRect): void {
    const core = this.core
    const root = this.modelObject
    if (core === null || root === null) return
    core.camera.updateMatrixWorld()
    root.updateMatrixWorld(true)
    const viewport = core.renderer.domElement.getBoundingClientRect()
    const names = nodeNamesInRect(root, rect, core.camera, viewport)
    if (names.length > 0) this.on.marqueeNodes(names)
  }

  // ⚠ 拖过视口不算点击：轨道相机的拖拽同样以 pointerup 收尾，不设位移阈值的话
  // 每次转镜头松手都会顺手把选中改掉
  private readonly onPointerUp = (event: PointerEvent): void => {
    const shiftSelectingPartNodes = this.shiftSelectingPartNodes
    this.shiftSelectingPartNodes = false
    if (this.marquee?.up(event) === true) {
      this.downValid = false
      this.setOrbitEnabled(true)
      return
    }
    this.setOrbitEnabled(true)
    if (!this.downValid || event.button !== 0) return
    this.downValid = false
    const moved = Math.hypot(
      event.clientX - this.downX,
      event.clientY - this.downY,
    )
    if (moved > CLICK_DRAG_THRESHOLD_PX) return
    this.handleClick(event.clientX, event.clientY, shiftSelectingPartNodes)
  }

  private readonly onPointerCancel = (): void => {
    this.downValid = false
    this.shiftSelectingPartNodes = false
    this.marquee?.cancel()
    this.setOrbitEnabled(true)
  }

  private canShiftSelectPartNodes(): boolean {
    return this.pickMode === null && this.selection?.kind === 'parts'
  }

  private handleClick(
    clientX: number,
    clientY: number,
    shiftSelectingPartNodes = false,
  ): void {
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
    if (shiftSelectingPartNodes) return this.pickPartNode()
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

  /** 左侧已选中部件时，Shift 单击把命中的节点追加到那一个部件。 */
  private pickPartNode(): void {
    const hit = this.firstModelHit()
    if (hit === null) return
    const name = nearestNamedName(hit.object)
    if (name !== '') this.on.marqueeNodes([name])
  }

  /**
   * 位置拾取：优先取模型表面的命中点。
   * ⚠ 没命中模型时落到地面上而不是什么都不给——模型还没挑好时也要能摆锚点。
   * ⚠ 那张地面是**看得见的那圈网格**（跟着基准原点的高度走），不是恒定的 y=0：
   * 两者不在一处时，用户点的是网格、拿回来的却是另一个高度上的点。
   */
  private pickPosition(): void {
    const hit = this.firstModelHit()
    if (hit !== null) {
      this.on.pickPosition([hit.point.x, hit.point.y, hit.point.z])
      return
    }
    const point = new THREE.Vector3()
    // three 的约定：normal·p + constant = 0，故过 y=h 的平面 constant 取 -h
    const ground = new THREE.Plane(GROUND_NORMAL, -this.coordOrigin[1])
    if (this.raycaster.ray.intersectPlane(ground, point) === null) return
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
