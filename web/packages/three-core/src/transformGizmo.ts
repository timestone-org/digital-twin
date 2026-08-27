/**
 * @fileoverview 编辑视口里的坐标轴手柄：选中锚点 / 信息牌 / 箭头之后直接在
 * 3D 里拖它们的位置，箭头还能拖朝向、信息牌能拖旋转。
 *
 * ⚠ 手柄附着的是一个**隐形替身**而不是实体本身：锚点与信息牌画出来的是 CSS2D
 * 标签（DOM，不在 3D 里占位），箭头是一整组网格，两者都不能直接被 attach。
 * ⚠ 拖动时必须关掉 OrbitControls：不关的话拖手柄会同时把镜头转走，
 * 手感是「越拖越跑偏」，而画面上看不出是两套控制在抢同一个指针。
 */
import type { Vec3 } from '@dt/twin-config'
import * as THREE from 'three'
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js'

import type { SceneCore } from './sceneCore'

/** 手柄相对视口的大小；默认 1 在小视口里会糊住整个模型。 */
const GIZMO_SIZE = 0.6

/** 箭头几何的本地轴，与 `arrowLayer` 那份必须一致。 */
const ARROW_AXIS = new THREE.Vector3(0, 1, 0)

/** 能拖的三类实体。其余要么没有自己的位置，要么位置另有来源。 */
export type GizmoKind = 'anchors' | 'panels' | 'arrows'

/** 手柄的两种模式；箭头转的是朝向向量，信息牌转的是欧拉角。 */
export type GizmoMode = 'translate' | 'rotate'

/** 手柄要摆到哪里、按什么姿态。 */
export interface GizmoTarget {
  kind: GizmoKind
  id: string
  position: Vec3
  /** 箭头的朝向；其余两类给 null。 */
  direction: Vec3 | null
  /** 信息牌的欧拉角（度）；其余两类给 null。 */
  rotation: Vec3 | null
}

/** 拖完一次之后回传的改动。 */
export interface GizmoChange {
  kind: GizmoKind
  id: string
  position: Vec3
  /** 只有箭头在 `rotate` 模式下会变。 */
  direction: Vec3 | null
  /** 只有信息牌在 `rotate` 模式下会变；欧拉角，度。 */
  rotation: Vec3 | null
}

export interface TransformGizmoOptions {
  core: SceneCore
  /** 拖动过程中持续回传，宿主据此实时更新配置。 */
  onChange: (change: GizmoChange) => void
  /**
   * 松手了。
   * ⚠ 宿主靠它把「一次拖动」合成一条撤销：`onChange` 是逐帧来的，
   * 各记一条的话撤销一次只退回一帧，用户要按几十下才回得到原位。
   */
  onDragEnd: () => void
}

/**
 * 坐标轴手柄。宿主在选中变化时 `attach`/`detach`，卸载时 `dispose`。
 */
export class TransformGizmo {
  private readonly core: SceneCore
  private readonly onChange: (change: GizmoChange) => void
  private readonly onDragEnd: () => void
  private readonly controls: TransformControls
  private readonly helper: THREE.Object3D
  /** 手柄真正附着的隐形替身。 */
  private readonly proxy = new THREE.Object3D()
  private target: GizmoTarget | null = null
  /** 程序在摆替身，这一段里的 `objectChange` 不算用户拖的。 */
  private applying = false
  private dragging = false

  constructor(options: TransformGizmoOptions) {
    this.core = options.core
    this.onChange = options.onChange
    this.onDragEnd = options.onDragEnd
    this.proxy.name = 'twin-gizmo-proxy'
    this.proxy.visible = false
    this.core.scene.add(this.proxy)

    this.controls = new TransformControls(
      this.core.camera,
      this.core.renderer.domElement,
    )
    this.controls.setSize(GIZMO_SIZE)
    this.controls.addEventListener('dragging-changed', this.onDraggingChanged)
    this.controls.addEventListener('objectChange', this.onObjectChange)
    this.helper = this.controls.getHelper()
    this.helper.name = 'twin-gizmo'
    this.helper.visible = false
    this.core.scene.add(this.helper)
  }

  /** 手柄这一刻画出来了没有；宿主与测试据此断言。 */
  get isShown(): boolean {
    return this.helper.visible
  }

  /** 用户正拖着手柄——这期间不该重建图层，否则替身会被摆回去。 */
  get isDragging(): boolean {
    return this.dragging
  }

  /**
   * 把手柄挂到一个实体上。
   * @param target 实体的位置与姿态；null = 收起手柄
   * @param mode 平移还是旋转；旋转只对箭头与信息牌有意义
   */
  attach(target: GizmoTarget | null, mode: GizmoMode = 'translate'): void {
    // ⚠ 拖的过程中不许重挂：那会把替身摆回拖动前的位置，手感是「拖一下弹回去」
    if (this.dragging) return
    if (target === null) return this.detach()

    this.applying = true
    this.target = target
    this.proxy.position.set(...target.position)
    this.proxy.quaternion.copy(orientationOf(target))
    this.proxy.visible = true
    // 旋转在本地系才符合直觉：世界系下转一个已经斜着的箭头，三个环与它对不上
    this.controls.setMode(mode)
    this.controls.setSpace(mode === 'rotate' ? 'local' : 'world')
    this.controls.attach(this.proxy)
    this.helper.visible = true
    this.applying = false
  }

  detach(): void {
    this.controls.detach()
    this.helper.visible = false
    this.proxy.visible = false
    this.target = null
  }

  dispose(): void {
    this.controls.removeEventListener(
      'dragging-changed',
      this.onDraggingChanged,
    )
    this.controls.removeEventListener('objectChange', this.onObjectChange)
    this.controls.detach()
    this.core.scene.remove(this.helper, this.proxy)
    this.controls.dispose()
  }

  private readonly onDraggingChanged = (event: { value: unknown }): void => {
    const wasDragging = this.dragging
    this.dragging = event.value === true
    // ⚠ 拖手柄时关掉轨道控制：两套控制抢同一个指针，表现是「越拖越跑偏」
    this.core.controls.enabled = !this.dragging
    if (wasDragging && !this.dragging) this.onDragEnd()
  }

  private readonly onObjectChange = (): void => {
    const target = this.target
    if (this.applying || target === null) return
    const p = this.proxy.position
    const direction =
      target.direction === null ? null : axisOf(this.proxy.quaternion)
    const rotation =
      target.rotation === null ? null : eulerDegreesOf(this.proxy.quaternion)
    this.onChange({
      kind: target.kind,
      id: target.id,
      position: [p.x, p.y, p.z],
      direction,
      rotation,
    })
  }
}

/** 实体姿态 → 四元数：箭头按朝向向量，信息牌按欧拉角，锚点用单位四元数。 */
function orientationOf(target: GizmoTarget): THREE.Quaternion {
  if (target.direction !== null) return directionQuaternion(target.direction)
  if (target.rotation !== null) {
    return new THREE.Quaternion().setFromEuler(eulerOf(target.rotation))
  }
  return new THREE.Quaternion()
}

/** 朝向向量 → 四元数；零向量当没配，用单位四元数。 */
function directionQuaternion(direction: Vec3): THREE.Quaternion {
  const quaternion = new THREE.Quaternion()
  const target = new THREE.Vector3(...direction)
  if (target.lengthSq() === 0) return quaternion
  target.normalize()
  // ⚠ 与 +Y 完全相反时叉积是零向量，`setFromUnitVectors` 会给出一个不确定的
  // 旋转；这一支与 `arrowLayer` 的同名处理必须一致，否则手柄与箭头指向不同
  if (target.dot(ARROW_AXIS) < -0.9999) {
    return quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI)
  }
  return quaternion.setFromUnitVectors(ARROW_AXIS, target)
}

/** 四元数 → 朝向向量，取回箭头的本地轴被转到了哪。 */
function axisOf(quaternion: THREE.Quaternion): Vec3 {
  const axis = ARROW_AXIS.clone().applyQuaternion(quaternion).normalize()
  return [axis.x, axis.y, axis.z]
}

/** 欧拉角（度）→ three 的欧拉对象；序固定 XYZ，与 `panelLayer` 那份必须一致。 */
function eulerOf(rotation: Vec3): THREE.Euler {
  return new THREE.Euler(
    THREE.MathUtils.degToRad(rotation[0]),
    THREE.MathUtils.degToRad(rotation[1]),
    THREE.MathUtils.degToRad(rotation[2]),
    'XYZ',
  )
}

/** 四元数 → 欧拉角（度），取回信息牌被转到的姿态。 */
function eulerDegreesOf(quaternion: THREE.Quaternion): Vec3 {
  const euler = new THREE.Euler().setFromQuaternion(quaternion, 'XYZ')
  return [
    THREE.MathUtils.radToDeg(euler.x),
    THREE.MathUtils.radToDeg(euler.y),
    THREE.MathUtils.radToDeg(euler.z),
  ]
}
