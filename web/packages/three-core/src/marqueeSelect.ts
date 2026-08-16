/**
 * @fileoverview 框选的几何：两点定矩形、把对象的包围盒投影到屏幕再判包含。
 * 不碰 DOM 也不碰事件——手势在 `editorScene` 里，这里只回答「框中了没有」。
 */
import * as THREE from 'three'

/** 屏幕坐标下的一块矩形，`DOMRect` 的结构性子集。 */
export interface ScreenRect {
  left: number
  top: number
  width: number
  height: number
}

/**
 * 两个端点定一个矩形；反着拖也要得到正的宽高。
 * @param ax 起点横坐标
 * @param ay 起点纵坐标
 * @param bx 终点横坐标
 * @param by 终点纵坐标
 */
export function rectFromPoints(
  ax: number,
  ay: number,
  bx: number,
  by: number,
): ScreenRect {
  return {
    left: Math.min(ax, bx),
    top: Math.min(ay, by),
    width: Math.abs(ax - bx),
    height: Math.abs(ay - by),
  }
}

/**
 * 对象的包围盒投影到屏幕后，整个落在框里吗。
 *
 * ⚠ 判「包含」而不是「相交」：相交的话框住画面一角就会把背后一大片远处的
 * 几何一起选中，而用户看到的只是自己框了一小块。
 * ⚠ 任何一个角落在视锥之外（`z` 出界）就整体不算：那说明对象横跨近裁面，
 * 投影坐标已经翻折，算出来的屏幕包围盒是错的。
 *
 * @param object 要判定的对象
 * @param rect 屏幕上的框
 * @param camera 当前相机
 * @param viewport 画布在屏幕上的位置与大小
 */
export function projectedBoxInRect(
  object: THREE.Object3D,
  rect: ScreenRect,
  camera: THREE.Camera,
  viewport: ScreenRect,
): boolean {
  const box = new THREE.Box3().setFromObject(object)
  if (box.isEmpty()) return false

  const point = new THREE.Vector3()
  for (const [x, y, z] of BOX_CORNERS) {
    point.set(
      x === 0 ? box.min.x : box.max.x,
      y === 0 ? box.min.y : box.max.y,
      z === 0 ? box.min.z : box.max.z,
    )
    point.project(camera)
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return false
    if (point.z < -1 || point.z > 1) return false
    const screenX = viewport.left + ((point.x + 1) / 2) * viewport.width
    const screenY = viewport.top + ((1 - point.y) / 2) * viewport.height
    if (screenX < rect.left || screenX > rect.left + rect.width) return false
    if (screenY < rect.top || screenY > rect.top + rect.height) return false
  }
  return true
}

/** 包围盒的八个角，按三个轴各取 min / max。 */
const BOX_CORNERS: readonly (readonly [number, number, number])[] = [
  [0, 0, 0],
  [0, 0, 1],
  [0, 1, 0],
  [0, 1, 1],
  [1, 0, 0],
  [1, 0, 1],
  [1, 1, 0],
  [1, 1, 1],
]

/**
 * 这个对象这一刻真的画在屏幕上吗——自己与每一层祖先都得可见。
 * ⚠ 与射线拾取同一条口径：看不见的东西不该被框中，否则用户框了一片空白
 * 却选出一堆已经隐藏的部件。
 * @param object 要判定的对象
 */
export function isRenderable(object: THREE.Object3D): boolean {
  for (let node: THREE.Object3D | null = object; node; node = node.parent) {
    if (!node.visible) return false
  }
  return true
}

/**
 * 框中了哪些命名节点，去重后按字典序。
 *
 * ⚠ 只收**有名字**的节点：部件按节点名匹配几何，无名网格选中了也配不上部件。
 * 网格自己没名字时向上找最近的具名祖先——glTF 里一个部件常常是一个具名分组
 * 底下挂着一堆无名网格。
 *
 * @param root 模型根
 * @param rect 屏幕上的框
 * @param camera 当前相机
 * @param viewport 画布在屏幕上的位置与大小
 */
export function nodeNamesInRect(
  root: THREE.Object3D,
  rect: ScreenRect,
  camera: THREE.Camera,
  viewport: ScreenRect,
): string[] {
  const found = new Set<string>()
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return
    if (!isRenderable(object)) return
    if (!projectedBoxInRect(object, rect, camera, viewport)) return
    const name = namedAncestorOf(object)
    if (name !== '') found.add(name)
  })
  return [...found].sort()
}

/** 自己或最近的具名祖先的名字；一路到根都没有就给空串。 */
function namedAncestorOf(object: THREE.Object3D): string {
  for (let node: THREE.Object3D | null = object; node; node = node.parent) {
    const name = node.name.trim()
    if (name !== '') return name
  }
  return ''
}
