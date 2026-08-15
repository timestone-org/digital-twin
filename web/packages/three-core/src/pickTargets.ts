/**
 * @fileoverview 编辑视口的拾取件：给锚点、信息牌、箭头、能量流各挂一枚可射线命中的
 * 小标记，外加「客户端坐标 → NDC」「命中对象 → 部件」这两处判定。
 *
 * ⚠ 标记与运行态渲染层（`SceneLayers`）是两套对象：渲染层的小球尺寸跟模型体量走，
 * 大模型上小到点不中；标记只服务拾取与选中反馈，故按屏幕像素单独换算尺寸。
 */
import type {
  TwinAnchor,
  TwinConfig,
  TwinFlowLink,
  TwinPanel,
  TwinPart,
  Vec3,
} from '@dt/twin-config'
import * as THREE from 'three'

import { ACCENT_COLOR_TOKEN, resolveColorSpec } from './themeColor'

/**
 * `TwinConfig` 上六个可增删实体集合的名字。
 * ⚠ 本包看不见编辑器页面，这里与页面侧的 `TwinSelection` 是**结构性对齐**的两份声明。
 * 对不上不会静默：视口组件把两者直接接在一起，差一个成员就是编译期错误。
 */
export type TwinSceneEntityKind =
  'parts' | 'anchors' | 'cameras' | 'panels' | 'arrows' | 'flows'

/** 编辑视口认得的选中；`model` 与 `viewpoints` 是单例段，没有 id。 */
export type TwinSceneSelection =
  | { kind: 'model' }
  | { kind: 'viewpoints' }
  | { kind: TwinSceneEntityKind; id: string }

/** 视口里能直接点中的四类实体。部件靠模型网格命中，视点没有实体。 */
export type TwinPickableKind = 'anchors' | 'panels' | 'arrows' | 'flows'

/** 一个可点选实体在世界坐标里的落点。 */
export interface TwinPickPoint {
  kind: TwinPickableKind
  id: string
  position: Vec3
}

/** 画布在客户端坐标下的矩形，`DOMRect` 的结构性子集。 */
export interface ViewportRect {
  left: number
  top: number
  width: number
  height: number
}

/** token 取不出时的装饰色兜底，只影响标记外观、不影响任何读数 */
const ACCENT_FALLBACK = '#00cefc'
const SPHERE_SEGMENTS_H = 12
const SPHERE_SEGMENTS_V = 8
/** 常态标记直径，屏幕像素 */
const MARKER_DIAMETER_PX = 16
/** 选中标记直径，屏幕像素 */
const SELECTED_DIAMETER_PX = 26
const IDLE_OPACITY = 0.18
const SELECTED_OPACITY = 0.85
/** 标记压在模型与覆盖层之上 */
const MARKER_RENDER_ORDER = 980
const SELECTED_RENDER_ORDER = 990
/** 还没按相机换算过时的缩放，避免第一帧是个半径 1 的巨球 */
const INITIAL_MARKER_SCALE = 0.05
/** 相机与标记重合时的距离下限，除零会让缩放变 Infinity */
const MIN_CAMERA_DISTANCE = 0.001

interface PickEntry {
  selection: TwinSceneSelection
  mesh: THREE.Mesh
  material: THREE.MeshBasicMaterial
}

/**
 * 两个选中是不是同一个。⚠ 选中态是对象，`===` 比不出来。
 * @param left 一个选中
 * @param right 另一个选中
 */
export function isSameSceneSelection(
  left: TwinSceneSelection | null,
  right: TwinSceneSelection | null,
): boolean {
  if (left === null || right === null) return left === right
  if (left.kind !== right.kind) return false
  const leftId = 'id' in left ? left.id : ''
  const rightId = 'id' in right ? right.id : ''
  return leftId === rightId
}

/** 锚点 id → 世界坐标。 */
function anchorPositions(
  anchors: readonly TwinAnchor[],
): ReadonlyMap<string, Vec3> {
  return new Map(anchors.map((anchor) => [anchor.id, anchor.position]))
}

/**
 * 信息牌落点：锚点优先，锚点悬空时退回自带坐标，再叠偏移。
 * @param panel 归一化后的信息牌
 * @param byId 锚点 id → 世界坐标
 */
function panelPosition(
  panel: TwinPanel,
  byId: ReadonlyMap<string, Vec3>,
): Vec3 {
  const base =
    panel.anchorId === ''
      ? panel.position
      : (byId.get(panel.anchorId) ?? panel.position)
  return [
    base[0] + panel.offset[0],
    base[1] + panel.offset[1],
    base[2] + panel.offset[2],
  ]
}

/**
 * 能量流落点：路径上解析得出的锚点的中点。
 * ⚠ 不足两点返回 null：那条流本来就画不出线，给个标记等于让人点中一条看不见的东西。
 * @param flow 归一化后的能量流
 * @param byId 锚点 id → 世界坐标
 */
function flowPosition(
  flow: TwinFlowLink,
  byId: ReadonlyMap<string, Vec3>,
): Vec3 | null {
  const points: Vec3[] = []
  for (const anchorId of flow.pathAnchors) {
    const position = byId.get(anchorId)
    if (position !== undefined) points.push(position)
  }
  if (points.length < 2) return null
  const sum: Vec3 = [0, 0, 0]
  for (const point of points) {
    sum[0] += point[0]
    sum[1] += point[1]
    sum[2] += point[2]
  }
  return [
    sum[0] / points.length,
    sum[1] / points.length,
    sum[2] / points.length,
  ]
}

/** 能量流的落点集合，路径解析不出的整条跳过。 */
function flowPickPoints(
  flows: readonly TwinFlowLink[],
  byId: ReadonlyMap<string, Vec3>,
): TwinPickPoint[] {
  const found: TwinPickPoint[] = []
  for (const flow of flows) {
    if (!flow.visibility.visible) continue
    const position = flowPosition(flow, byId)
    if (position !== null) found.push({ kind: 'flows', id: flow.id, position })
  }
  return found
}

/**
 * 配置里全部可点选实体的落点，按「锚点 → 信息牌 → 箭头 → 能量流」的文档序。
 * ⚠ 只收 `visibility.visible` 为真的：画都没画出来的东西点得中，会让人以为它还在场上。
 * @param config 归一化后的孪生配置
 */
export function entityPickPoints(config: TwinConfig): TwinPickPoint[] {
  const byId = anchorPositions(config.anchors)
  return [
    ...config.anchors
      .filter((anchor) => anchor.visibility.visible)
      .map((anchor): TwinPickPoint => ({
        kind: 'anchors',
        id: anchor.id,
        position: anchor.position,
      })),
    ...config.panels
      .filter((panel) => panel.visibility.visible)
      .map((panel): TwinPickPoint => ({
        kind: 'panels',
        id: panel.id,
        position: panelPosition(panel, byId),
      })),
    ...config.arrows
      .filter((arrow) => arrow.visibility.visible)
      .map((arrow): TwinPickPoint => ({
        kind: 'arrows',
        id: arrow.id,
        position: arrow.position,
      })),
    ...flowPickPoints(config.flows, byId),
  ]
}

/**
 * 客户端坐标 → three 的归一化设备坐标；矩形塌成零宽高时返回 null。
 * ⚠ 不判零宽高的话除法会得到 ±Infinity 或 NaN，射线方向整条变 NaN 而一声不吭，
 * 表现为「点哪都选不中」。
 * @param rect 画布在客户端坐标下的矩形
 * @param clientX 指针横坐标
 * @param clientY 指针纵坐标
 */
export function ndcFromClient(
  rect: ViewportRect,
  clientX: number,
  clientY: number,
): { x: number; y: number } | null {
  if (rect.width <= 0 || rect.height <= 0) return null
  return {
    x: ((clientX - rect.left) / rect.width) * 2 - 1,
    y: -((clientY - rect.top) / rect.height) * 2 + 1,
  }
}

/**
 * 对象是不是真的可见——要上溯整条祖先链。
 * ⚠ 只看 `object.visible` 会把「自己可见但父级被隐藏」的对象当成可见，
 * 于是隐藏部件照样点得中；而 three 的射线本身根本不看可见性。
 * @param object 命中的对象
 */
export function isVisibleInTree(object: THREE.Object3D): boolean {
  let node: THREE.Object3D | null = object
  while (node !== null) {
    if (!node.visible) return false
    node = node.parent
  }
  return true
}

/**
 * 沿祖先链找最近的有名字的节点名，整条都没有名字返回空串。
 * ⚠ glTF 里网格常常挂在一个匿名节点下，直接取 `hit.object.name` 会得到空串，
 * 表现是「点了模型没反应」。
 * @param object 命中的对象
 */
export function nearestNamedName(object: THREE.Object3D | null): string {
  let node = object
  while (node !== null) {
    const name = node.name.trim()
    if (name !== '') return name
    node = node.parent
  }
  return ''
}

/**
 * 命中的对象属于哪个部件；沿祖先链找第一个被部件引用的节点名，找不到返回空串。
 * @param object 命中的对象
 * @param parts 归一化后的部件
 */
export function partIdOfObject(
  object: THREE.Object3D | null,
  parts: readonly TwinPart[],
): string {
  let node = object
  while (node !== null) {
    const name = node.name.trim()
    const part =
      name === '' ? undefined : parts.find((item) => item.nodes.includes(name))
    if (part !== undefined) return part.id
    node = node.parent
  }
  return ''
}

/**
 * 一个屏幕像素在给定世界点处折合多少世界单位，用来让标记保持固定的屏幕尺寸。
 * @param camera 透视相机
 * @param worldPosition 标记所在的世界坐标
 * @param viewportHeight 视口高度，像素
 */
export function worldUnitsPerPixel(
  camera: THREE.PerspectiveCamera,
  worldPosition: THREE.Vector3,
  viewportHeight: number,
): number {
  const height = Math.max(1, viewportHeight)
  const distance = Math.max(
    MIN_CAMERA_DISTANCE,
    camera.position.distanceTo(worldPosition),
  )
  const halfFov = THREE.MathUtils.degToRad(camera.fov) * 0.5
  return (2 * Math.tan(halfFov) * distance) / height
}

/** 一层拾取标记。宿主挂载时建一份，卸载时 `dispose`。 */
export class PickTargets {
  readonly group = new THREE.Group()

  /** 读 CSS 变量级联的宿主元素。 */
  private readonly host: HTMLElement | null
  private entries: PickEntry[] = []
  private geometry: THREE.SphereGeometry | null = null
  private selected: TwinSceneSelection | null = null

  constructor(host: HTMLElement | null) {
    this.host = host
    this.group.name = 'twin-pick-targets'
  }

  /**
   * 按配置重建全部标记。
   * @param config 归一化后的孪生配置
   */
  build(config: TwinConfig): void {
    this.clear()
    const points = entityPickPoints(config)
    if (points.length === 0) return
    const geometry = new THREE.SphereGeometry(
      1,
      SPHERE_SEGMENTS_H,
      SPHERE_SEGMENTS_V,
    )
    this.geometry = geometry
    const color =
      resolveColorSpec(ACCENT_COLOR_TOKEN, this.host) ??
      new THREE.Color(ACCENT_FALLBACK)
    for (const point of points) {
      this.entries.push(this.createEntry(point, geometry, color))
    }
    this.applySelectionStyle()
  }

  /**
   * 换选中态：选中的那枚放大加亮。
   * @param selection 当前选中，null = 没有
   */
  setSelected(selection: TwinSceneSelection | null): void {
    this.selected = selection
    this.applySelectionStyle()
  }

  /**
   * 按相机距离换算世界缩放，让标记保持稳定的屏幕尺寸。
   * @param camera 透视相机
   * @param viewportHeight 视口高度，像素
   */
  updateForCamera(
    camera: THREE.PerspectiveCamera,
    viewportHeight: number,
  ): void {
    for (const entry of this.entries) {
      const unit = worldUnitsPerPixel(
        camera,
        entry.mesh.position,
        viewportHeight,
      )
      const diameter = this.isSelected(entry)
        ? SELECTED_DIAMETER_PX
        : MARKER_DIAMETER_PX
      entry.mesh.scale.setScalar(unit * diameter * 0.5)
    }
  }

  /**
   * 射线命中的实体，没命中返回 null。
   * @param raycaster 已 `setFromCamera` 的射线
   */
  raycast(raycaster: THREE.Raycaster): TwinSceneSelection | null {
    // ⚠ 射线读的是 matrixWorld：不先刷一遍，配置刚改完那一拍的标记还停在旧位置上，
    // 表现是「刚拖走的锚点在原地还能点中」
    this.group.updateMatrixWorld(true)
    const hit = raycaster.intersectObjects(
      this.entries.map((entry) => entry.mesh),
      false,
    )[0]
    if (hit === undefined) return null
    return (
      this.entries.find((entry) => entry.mesh === hit.object)?.selection ?? null
    )
  }

  dispose(): void {
    this.clear()
  }

  private isSelected(entry: PickEntry): boolean {
    return isSameSceneSelection(this.selected, entry.selection)
  }

  private createEntry(
    point: TwinPickPoint,
    geometry: THREE.SphereGeometry,
    color: THREE.Color,
  ): PickEntry {
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: IDLE_OPACITY,
      depthTest: false,
      depthWrite: false,
    })
    const mesh = new THREE.Mesh(geometry, material)
    mesh.position.set(...point.position)
    mesh.scale.setScalar(INITIAL_MARKER_SCALE)
    mesh.renderOrder = MARKER_RENDER_ORDER
    this.group.add(mesh)
    return { selection: { kind: point.kind, id: point.id }, mesh, material }
  }

  private applySelectionStyle(): void {
    for (const entry of this.entries) {
      const selected = this.isSelected(entry)
      entry.material.opacity = selected ? SELECTED_OPACITY : IDLE_OPACITY
      entry.mesh.renderOrder = selected
        ? SELECTED_RENDER_ORDER
        : MARKER_RENDER_ORDER
    }
  }

  // ⚠ 不清 `selected`：配置改一次就把选中丢掉的话，右栏检查器与视口会各说各的
  private clear(): void {
    for (const entry of this.entries) {
      this.group.remove(entry.mesh)
      entry.material.dispose()
    }
    this.geometry?.dispose()
    this.geometry = null
    this.entries = []
  }
}
