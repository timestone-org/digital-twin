/**
 * @fileoverview 立体箭头层：一根杆 + 一个锥头 + 一张 CSS2D 标签。
 * ⚠ 标签文本一律走 `textContent`——箭头名、前缀与单位都是用户可控文本，
 * 拼进 `innerHTML` 就是一个注入点（code-style-typescript §10）。
 */
import type { TwinArrow, TwinArrowValues } from '@dt/twin-config'
import { formatArrowText } from '@dt/twin-config'
import * as THREE from 'three'
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js'

import { distanceResolver, type DistanceContext } from './distanceContext'
import { resolveVisibility } from './distanceRules'
import { resolveColorSpec } from './themeColor'

/** 没有读数时的占位符 */
const NO_VALUE_TEXT = '—'
/** 色规格取不出时的兜底，只影响外观、不影响任何读数 */
const COLOR_FALLBACK = '#00cefc'
const SHAFT_SEGMENTS = 8
const HEAD_SEGMENTS = 12
/** 锥头占整支箭头长度的比例 */
const HEAD_RATIO = 0.3
/** 锥头相对杆的粗细倍数 */
const HEAD_WIDTH_RATIO = 2.2
/** 杆的基准半径相对模型对角线 */
const SHAFT_RADIUS_RATIO = 0.004
const MIN_SHAFT_RADIUS = 0.01
const MAX_SHAFT_RADIUS = 0.4
/** 箭头基准长度相对模型对角线 */
const LENGTH_RATIO = 0.08
const MIN_LENGTH = 0.1
const MAX_LENGTH = 20
/** 箭头压在模型之上，与锚点同档 */
const ARROW_RENDER_ORDER = 920
/** 箭头自带的不透明度，距离淡出在它之上再乘一个系数 */
const ARROW_OPACITY = 0.95
/** 圆柱与圆锥的本地轴 */
const LOCAL_AXIS = new THREE.Vector3(0, 1, 0)

interface ArrowEntry {
  arrow: TwinArrow
  /** 杆与头共用的材质，淡出按 `ARROW_OPACITY` 成比例缩。 */
  material: THREE.MeshBasicMaterial
  /** 杆与头收在一个 pivot 下：定向与缩放只改这一个对象。 */
  pivot: THREE.Group
  shaft: THREE.Mesh
  head: THREE.Mesh
  label: CSS2DObject
  labelEl: HTMLElement
}

function styleLabel(element: HTMLElement): void {
  element.style.padding = '2px 8px'
  element.style.borderRadius = 'var(--radius-pill)'
  element.style.border = '1px solid var(--border-default)'
  element.style.background = 'var(--surface-sunken)'
  element.style.color = 'var(--text-secondary)'
  element.style.fontSize = '11px'
  element.style.lineHeight = '16px'
  element.style.whiteSpace = 'nowrap'
  element.style.userSelect = 'none'
}

/** 取不到就说取不到，不拿空串冒充读数。 */
function arrowText(arrow: TwinArrow, values: TwinArrowValues): string {
  const entry = values[arrow.id]
  const text =
    entry === undefined ? arrow.labelText : formatArrowText(arrow, entry.value)
  return text === '' ? NO_VALUE_TEXT : text
}

/**
 * 把 +Y 转到目标朝向的四元数。
 * ⚠ 方向与 +Y 完全相反时叉积是零向量，`setFromUnitVectors` 会给出一个
 * 不确定的旋转——那一支箭头会指向一个随机方向，且只在这一个角度上发生。
 */
function orientationOf(direction: THREE.Vector3): THREE.Quaternion {
  const target = direction.clone().normalize()
  const quaternion = new THREE.Quaternion()
  if (target.dot(LOCAL_AXIS) < -0.9999) {
    return quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI)
  }
  return quaternion.setFromUnitVectors(LOCAL_AXIS, target)
}

/** 立体箭头层。一个实例绑一份场景，换配置时 `build` 重建。 */
export class ArrowLayer {
  readonly group = new THREE.Group()
  private readonly host: HTMLElement | null
  private entries: ArrowEntry[] = []
  private shaftGeometry: THREE.CylinderGeometry | null = null
  private headGeometry: THREE.ConeGeometry | null = null
  private baseLength = MIN_LENGTH
  private baseRadius = MIN_SHAFT_RADIUS

  constructor(host: HTMLElement | null) {
    this.host = host
    this.group.name = 'twin-arrows'
  }

  /**
   * 重建全部箭头；`visible` 为假的不建对象。
   * @param arrows 归一化后的箭头
   */
  build(arrows: readonly TwinArrow[]): void {
    this.clear()
    // 只认作者直接置的显隐；随距离派生的那部分归取景层，不在这里算
    const shown = arrows.filter((arrow) => arrow.visibility.visible)
    if (shown.length === 0) return
    // 两份几何全场共用：一支箭头一份的话，几十支就是几十次 GPU 上传
    this.shaftGeometry = new THREE.CylinderGeometry(1, 1, 1, SHAFT_SEGMENTS)
    this.headGeometry = new THREE.ConeGeometry(1, 1, HEAD_SEGMENTS)
    for (const arrow of shown) this.entries.push(this.createEntry(arrow))
    this.applyScale()
  }

  /**
   * 刷新标签文本。
   * @param values 缝合后的箭头实时值
   */
  setValues(values: TwinArrowValues): void {
    for (const entry of this.entries) {
      entry.labelEl.textContent = arrowText(entry.arrow, values)
    }
  }

  /**
   * 按这一帧的取景状态更新显隐与淡出。
   * @param context 这一帧的相机与轨道中心
   */
  applyDistance(context: DistanceContext): void {
    for (const entry of this.entries) {
      const state = resolveVisibility(
        entry.arrow.visibility,
        distanceResolver(context, entry.arrow.position, null),
      )
      entry.pivot.visible = state.visible
      entry.label.visible = state.visible
      entry.material.opacity = ARROW_OPACITY * state.opacity
      entry.labelEl.style.opacity = String(state.opacity)
    }
  }

  /**
   * 箭头尺寸跟模型体量走，否则大模型上它细成一根线、小模型上盖住整个场景。
   * @param modelDiagonal 模型包围盒对角线长度
   */
  setWorldScale(modelDiagonal: number): void {
    const usable =
      Number.isFinite(modelDiagonal) && modelDiagonal > 0 ? modelDiagonal : 1
    this.baseLength = clamp(usable * LENGTH_RATIO, MIN_LENGTH, MAX_LENGTH)
    this.baseRadius = clamp(
      usable * SHAFT_RADIUS_RATIO,
      MIN_SHAFT_RADIUS,
      MAX_SHAFT_RADIUS,
    )
    this.applyScale()
  }

  dispose(): void {
    this.clear()
  }

  private createEntry(arrow: TwinArrow): ArrowEntry {
    const color =
      resolveColorSpec(arrow.color, this.host) ??
      new THREE.Color(COLOR_FALLBACK)
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: ARROW_OPACITY,
      depthTest: false,
    })
    // 断言的理由：`build` 里刚建好这两份几何，进不到这里时它们必不为 null
    const shaft = new THREE.Mesh(this.shaftGeometry ?? undefined, material)
    const head = new THREE.Mesh(this.headGeometry ?? undefined, material)
    shaft.renderOrder = ARROW_RENDER_ORDER
    head.renderOrder = ARROW_RENDER_ORDER
    const pivot = new THREE.Group()
    pivot.position.set(...arrow.position)
    pivot.quaternion.copy(orientationOf(new THREE.Vector3(...arrow.direction)))
    pivot.add(shaft, head)

    const element = document.createElement('div')
    element.textContent =
      arrow.labelText === '' ? NO_VALUE_TEXT : arrow.labelText
    styleLabel(element)
    const label = new CSS2DObject(element)
    this.group.add(pivot, label)
    return { arrow, material, pivot, shaft, head, label, labelEl: element }
  }

  /** 长度与粗细都按「基准 × 本箭头的倍率」算，几何本身恒为单位大小。 */
  private applyScale(): void {
    for (const entry of this.entries) {
      const length = this.baseLength * entry.arrow.length
      const radius = this.baseRadius * entry.arrow.width
      const headLength = length * HEAD_RATIO
      const shaftLength = length - headLength
      entry.shaft.scale.set(radius, shaftLength, radius)
      entry.shaft.position.set(0, shaftLength / 2, 0)
      entry.head.scale.set(
        radius * HEAD_WIDTH_RATIO,
        headLength,
        radius * HEAD_WIDTH_RATIO,
      )
      entry.head.position.set(0, shaftLength + headLength / 2, 0)
      // 标签挂在箭尖外一点，别压住锥头
      entry.label.position.copy(entry.pivot.position)
      entry.label.position.addScaledVector(
        new THREE.Vector3(...entry.arrow.direction).normalize(),
        length * 1.1,
      )
    }
  }

  // ⚠ CSS2D 的 DOM 元素挂在标签层容器里，光从场景图上摘下对象带不走它——
  // 漏了这一步，卸载后标签还留在页面上飘着
  private clear(): void {
    const materials = new Set<THREE.Material>()
    for (const entry of this.entries) {
      entry.label.element.remove()
      this.group.remove(entry.pivot, entry.label)
      if (entry.shaft.material instanceof THREE.Material) {
        materials.add(entry.shaft.material)
      }
    }
    for (const material of materials) material.dispose()
    this.shaftGeometry?.dispose()
    this.headGeometry?.dispose()
    this.shaftGeometry = null
    this.headGeometry = null
    this.entries = []
  }
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}
