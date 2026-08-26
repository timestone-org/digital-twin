/**
 * @fileoverview 信息牌层：锚定在锚点或世界坐标上的一张卡片。
 *
 * ⚠ 卡片是 **CSS3D** 不是 CSS2D：后者是叠在屏幕上的 DOM，恒定像素大小、永远
 * 正对屏幕，于是「随模型缩放」与「钉死朝向」两件事都做不到。换成 CSS3D 之后
 * DOM 真进 3D 空间，代价是它与 WebGL 几何之间没有深度遮挡——牌永远画在模型
 * 之上，被挡住的牌也看得见。
 * ⚠ 本层不建任何 GPU 几何：卡片是 DOM。要清的只有 DOM，但它一定要清——
 * 从场景图上摘下对象带不走它的元素。
 * ⚠ 卡片长什么样全在 `panelCard` 与 `styles/panel.scss`：这里只管落点、朝向、
 * 尺寸与显隐这四样与三维有关的事。
 */
import type {
  TwinAnchor,
  TwinBillboardMode,
  TwinPanel,
  Vec3,
} from '@dt/twin-config'
import { EMPTY_PANEL_VALUES } from '@dt/twin-config'
import type { TwinPanelValues } from '@dt/twin-config'
import * as THREE from 'three'
import { CSS3DObject } from 'three/examples/jsm/renderers/CSS3DRenderer.js'

import { distanceResolver, type DistanceContext } from './distanceContext'
import { resolveVisibility } from './distanceRules'
import {
  buildPanelCard,
  paintPanelField,
  type PanelFieldView,
} from './panelCard'

interface PanelEntry {
  panel: TwinPanel
  label: CSS3DObject
  fields: PanelFieldView[]
}

/** 牌的落点已经在 `label.position` 上，距离规则直接读它，不再算第二遍。 */

/**
 * 牌的落点：锚点优先，锚点找不到时退回自己的坐标。
 * ⚠ 退回而不是不画：一张配好了字段的牌因为锚点被删就整个消失，用户只会觉得
 * 「我的牌哪去了」。悬空引用由 `collectTwinConfigIssues` 单独报出来。
 */
function positionOf(panel: TwinPanel, anchors: readonly TwinAnchor[]): Vec3 {
  const anchor =
    panel.anchorId === ''
      ? undefined
      : anchors.find((item) => item.id === panel.anchorId)
  const base = anchor?.position ?? panel.position
  return [
    base[0] + panel.offset[0],
    base[1] + panel.offset[1],
    base[2] + panel.offset[2],
  ]
}

/** 竖轴，`horizontal` 档绕它转。 */
const UP = new THREE.Vector3(0, 1, 0)

/**
 * 把一张牌摆成它该有的朝向。
 * @param label 牌对象
 * @param mode 朝向档
 * @param camera 当前相机
 */
function applyBillboard(
  label: THREE.Object3D,
  mode: TwinBillboardMode,
  camera: THREE.Camera,
): void {
  if (mode === 'fixed') return
  if (mode === 'face') {
    // 直接抄相机的姿态：牌与成像平面平行，怎么转都是正面
    label.quaternion.copy(camera.quaternion)
    return
  }
  // horizontal：只在水平面内转向相机，牌因此永远是竖着的
  const toCamera = camera.position.clone().sub(label.position)
  toCamera.y = 0
  // 相机正好在牌的正上方 / 正下方时水平分量是零，没有方向可言——保持上一帧的
  // 朝向，硬转会让牌在俯视那一瞬间乱甩
  if (toCamera.lengthSq() === 0) return
  label.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 0, 1),
    toCamera.normalize(),
  )
  label.up.copy(UP)
}

/**
 * 世界缩放与模型体量的比例：一张约 200px 的牌缩放后占模型对角线的一成上下。
 * ⚠ CSS3D 里 1px 就是 1 个世界单位，不缩的话一张牌能盖住整个厂区。
 * ⚠ 这是个**纯比例**，不该早早封顶：封顶之后模型越大牌的占比越小，
 * 大厂区上就成了一个看不清的小点——牌该始终占模型的固定份额。
 */
const CARD_WIDTH_RATIO = 0.0005
/** 兜底区间，只挡住体量为 0 或畸形值那两种极端。 */
const MIN_CARD_SCALE = 1e-4
const MAX_CARD_SCALE = 10

/** 信息牌层。一个实例绑一份场景，换配置时 `build` 重建。 */
export class PanelLayer {
  readonly group = new THREE.Group()
  private entries: PanelEntry[] = []
  /** 按模型体量算出来的基准缩放；每张牌在它之上再乘自己的倍率。 */
  private baseScale = MIN_CARD_SCALE

  constructor() {
    this.group.name = 'twin-panels'
  }

  /**
   * 按模型体量重算卡片大小。
   * ⚠ 这是「牌不随模型缩放」的落点：CSS3D 的元素在世界里有真实尺寸，
   * 模型换了体量却不跟着缩，小模型上牌能盖满全屏、大模型上牌小成一个点。
   * @param modelDiagonal 模型包围盒对角线长度
   */
  setWorldScale(modelDiagonal: number): void {
    const usable =
      Number.isFinite(modelDiagonal) && modelDiagonal > 0 ? modelDiagonal : 1
    this.baseScale = Math.min(
      MAX_CARD_SCALE,
      Math.max(MIN_CARD_SCALE, usable * CARD_WIDTH_RATIO),
    )
    for (const entry of this.entries) {
      this.applyScale(entry)
    }
  }

  /** 基准缩放乘这张牌自己的倍率。 */
  private applyScale(entry: PanelEntry): void {
    entry.label.scale.setScalar(this.baseScale * entry.panel.style.scale)
  }

  /**
   * 按这一帧的相机摆每张牌的朝向。
   * ⚠ 每帧都要调：`face` 与 `horizontal` 两档是跟着相机转的，只在建的时候
   * 摆一次的话，镜头一动牌就斜了。
   * @param camera 当前相机
   */
  faceCamera(camera: THREE.Camera): void {
    for (const entry of this.entries) {
      applyBillboard(entry.label, entry.panel.billboard, camera)
    }
  }

  /**
   * 重建全部信息牌；`visible` 为假的不建卡片。
   * @param panels 归一化后的信息牌
   * @param anchors 归一化后的锚点，用来解析 `anchorId`
   */
  build(panels: readonly TwinPanel[], anchors: readonly TwinAnchor[]): void {
    this.clear()
    // 只认作者直接置的显隐；随距离派生的那部分归取景层，不在这里算
    for (const panel of panels) {
      if (!panel.visibility.visible) continue
      this.entries.push(this.createEntry(panel, anchors))
    }
    // ⚠ 建完立刻按「没有实时值」刷一遍：不刷的话，只配了静态文案的牌会一直
    // 显示占位符直到第一次 setValues 到来——而一个点位都没绑的牌永远等不到
    this.setValues(EMPTY_PANEL_VALUES)
  }

  /**
   * 刷新每个字段的值。
   * @param values 缝合后的信息牌字段值，键是 `<牌 id>::<字段 key>`
   */
  setValues(values: TwinPanelValues): void {
    for (const entry of this.entries) {
      for (const view of entry.fields) {
        paintPanelField(view, values)
      }
    }
  }

  /**
   * 按这一帧的取景状态更新显隐与淡出。
   * ⚠ 卡片是 DOM，靠 `object.visible` 隐藏（渲染器会跟着把元素 `display: none`）；
   * 不透明度只能落在元素的 style 上，材质那条路这里没有。
   * @param context 这一帧的相机与轨道中心
   */
  applyDistance(context: DistanceContext): void {
    for (const entry of this.entries) {
      const state = resolveVisibility(
        entry.panel.visibility,
        distanceResolver(context, entry.label.position, null),
      )
      entry.label.visible = state.visible
      entry.label.element.style.opacity = String(state.opacity)
    }
  }

  dispose(): void {
    this.clear()
  }

  private createEntry(
    panel: TwinPanel,
    anchors: readonly TwinAnchor[],
  ): PanelEntry {
    const card = buildPanelCard(panel)
    const label = new CSS3DObject(card.mount)
    label.position.set(...positionOf(panel, anchors))
    label.scale.setScalar(this.baseScale * panel.style.scale)
    this.group.add(label)
    return { panel, label, fields: card.fields }
  }

  // ⚠ CSS3D 的 DOM 元素挂在标签层容器里，从场景图上摘下对象带不走它——
  // 漏了这一步，卸载后卡片还留在页面上飘着
  private clear(): void {
    for (const entry of this.entries) {
      entry.label.element.remove()
      this.group.remove(entry.label)
    }
    this.entries = []
  }
}
