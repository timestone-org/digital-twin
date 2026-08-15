/**
 * @fileoverview 视口里的部件点击：把一次指针操作判成「点击」还是「拖拽」，
 * 再射线求它命中了哪个部件。
 *
 * ⚠ 拖拽松手也会派发 click，所以不能直接听 click：转了一圈镜头再松手会被当成
 * 点了一下部件，运行态那边就凭空触发一次联动。这里按 pointerdown/pointerup
 * 配对，位移超过阈值即判为拖拽。
 */
import type { TwinPart } from '@dt/twin-config'
import * as THREE from 'three'

import { distanceResolver, type DistanceContext } from './distanceContext'
import { resolveClickGate } from './distanceRules'

/** 判成拖拽的位移阈值（CSS 像素）。手抖几像素仍算点击。 */
export const DRAG_SLOP_PX = 4

interface PointerStart {
  x: number
  y: number
}

/** 一次指针操作的判定器。宿主在 pointerdown/pointerup 上各调一次。 */
export class ClickGesture {
  private start: PointerStart | null = null

  down(event: PointerEvent): void {
    this.start = { x: event.clientX, y: event.clientY }
  }

  /** 松手时问：这算一次点击吗？无论结果如何都会清掉起点。 */
  isClick(event: PointerEvent): boolean {
    const start = this.start
    this.start = null
    if (start === null) return false
    return (
      Math.hypot(event.clientX - start.x, event.clientY - start.y) <=
      DRAG_SLOP_PX
    )
  }

  /** 指针离开或被系统取消时丢掉起点，免得下一次松手借用上一次的起点。 */
  cancel(): void {
    this.start = null
  }
}

/**
 * 把指针位置换成 NDC 坐标。
 * ⚠ 必须用元素的 `getBoundingClientRect` 而不是窗口尺寸：视口只占页面的一块，
 * 用窗口尺寸算出来的射线会整体偏移，表现为「点 A 选中了 B」。
 */
function ndcOf(event: PointerEvent, element: HTMLElement): THREE.Vector2 {
  const rect = element.getBoundingClientRect()
  return new THREE.Vector2(
    ((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
    -((event.clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1,
  )
}

/**
 * 这个对象这一刻真的画在屏幕上吗——自己与每一层祖先都得可见。
 *
 * ⚠ 只看对象自己的 `visible` 是不够的：部件的显隐落在**被命名的那个节点**上，
 * 而射线命中的是它下面的网格。父节点被距离规则隐藏之后，子网格自己的
 * `visible` 仍是 true，于是「看不见的东西照样点得中」。
 */
function isRenderable(object: THREE.Object3D): boolean {
  for (let node: THREE.Object3D | null = object; node; node = node.parent) {
    if (!node.visible) return false
  }
  return true
}

/**
 * 射线求最近的命中对象；没打中给 null。
 *
 * ⚠ three 的 `Raycaster` **完全不看 `visible`**，隐藏的对象照样会被命中。
 * 可见性得在这里自己滤，漏了就是「看不见却点得到」。
 *
 * @param event 指针事件
 * @param element 视口元素，用来把屏幕坐标换成 NDC
 * @param camera 当前相机
 * @param root 只在这棵子树里找（模型根，不含覆盖层）
 */
export function pickObject(
  event: PointerEvent,
  element: HTMLElement,
  camera: THREE.Camera,
  root: THREE.Object3D,
): THREE.Object3D | null {
  const raycaster = new THREE.Raycaster()
  raycaster.setFromCamera(ndcOf(event, element), camera)
  const hit = raycaster
    .intersectObject(root, true)
    .find((item) => isRenderable(item.object))
  return hit?.object ?? null
}

/** 点中一个部件（且通过了距离门禁）时上抛的东西。 */
export interface TwinPartClick {
  partId: string
  partName: string
}

/** 一次视口点击落到了什么结果上。 */
export type PartClickOutcome =
  | { kind: 'none' }
  /** 太远，先把镜头拉到这个盒子上；这一下不算真点击。 */
  | { kind: 'approach'; box: THREE.Box3 }
  | ({ kind: 'click' } & TwinPartClick)

const NOTHING: PartClickOutcome = { kind: 'none' }

/**
 * 把一次松手判到底：算不算点击、命中哪个部件、这个距离允不允许点。
 *
 * ⚠ 判定收在这里而不是散在宿主组件里：宿主只负责把结果落成 emit 或移镜头，
 * 三条分支（挡掉 / 拉近 / 上抛）才不会在某次改动里少掉一条。
 *
 * @param event 松手事件
 * @param deps 视口元素、相机、模型根、部件层与取距离所需的取景状态
 */
export function resolvePartClick(deps: {
  event: PointerEvent
  element: HTMLElement
  camera: THREE.Camera
  modelRoot: THREE.Object3D
  parts: PartClickParts
  context: DistanceContext
}): PartClickOutcome {
  const object = pickObject(
    deps.event,
    deps.element,
    deps.camera,
    deps.modelRoot,
  )
  if (object === null) return NOTHING
  const part = deps.parts.partAt(object)
  if (part === null) return NOTHING

  const center = deps.parts.centerOf(part.id)
  const gate = resolveClickGate(
    part.clickDistance,
    distanceResolver(deps.context, center, center),
  )
  if (gate === 'block') return NOTHING
  if (gate === 'approach') {
    const box = deps.parts.boxOf(part.id)
    return box === null ? NOTHING : { kind: 'approach', box }
  }
  return { kind: 'click', partId: part.id, partName: part.name }
}

/** 判定要用到的部件层能力；收窄成接口，测试里给个假件就够。 */
export interface PartClickParts {
  partAt: (object: THREE.Object3D) => TwinPart | null
  centerOf: (partId: string) => THREE.Vector3 | null
  boxOf: (partId: string) => THREE.Box3 | null
}
