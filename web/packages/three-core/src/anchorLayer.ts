/**
 * @fileoverview 锚点层：世界坐标上的一个小球 + 一张 CSS2D 读数标签。
 * ⚠ 标签文本一律走 `textContent`——锚点名、前缀与单位都是用户可控文本，
 * 拼进 `innerHTML` 就是一个注入点（code-style-typescript §10）。
 */
import type { TwinAnchor, TwinAnchorValues } from '@dt/twin-config'
import { formatAnchorText } from '@dt/twin-config'
import * as THREE from 'three'
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js'

import { ACCENT_COLOR_TOKEN, resolveColorSpec } from './themeColor'

/** 没有读数时的占位符 */
const NO_VALUE_TEXT = '—'
/** token 取不出时的装饰色兜底，只影响小球外观、不影响任何读数 */
const ACCENT_FALLBACK = '#00cefc'
const DOT_SEGMENTS_H = 12
const DOT_SEGMENTS_V = 8
/** 小球半径相对模型对角线 */
const DOT_RADIUS_RATIO = 0.006
const MIN_DOT_RADIUS = 0.02
const MAX_DOT_RADIUS = 0.6
/** 标签相对小球半径的上抬倍数 */
const LABEL_LIFT = 2.2
/** 锚点压在模型之上 */
const ANCHOR_RENDER_ORDER = 920

interface AnchorEntry {
  anchor: TwinAnchor
  dot: THREE.Mesh
  label: CSS2DObject
  valueEl: HTMLElement
}

function styleLabel(element: HTMLElement, valueEl: HTMLElement): void {
  element.style.display = 'flex'
  element.style.alignItems = 'baseline'
  element.style.gap = '4px'
  element.style.padding = '2px 8px'
  element.style.borderRadius = 'var(--radius-pill)'
  element.style.border = '1px solid var(--border-default)'
  element.style.background = 'var(--surface-sunken)'
  element.style.color = 'var(--text-secondary)'
  element.style.fontSize = '11px'
  element.style.lineHeight = '16px'
  element.style.whiteSpace = 'nowrap'
  element.style.userSelect = 'none'
  valueEl.style.color = 'var(--accent-primary)'
  valueEl.style.fontWeight = '700'
  valueEl.style.fontVariantNumeric = 'tabular-nums'
}

/** 取不到就说取不到，不拿空串冒充读数。 */
function anchorText(anchor: TwinAnchor, values: TwinAnchorValues): string {
  const entry = values[anchor.id]
  if (entry === undefined) return NO_VALUE_TEXT
  const text = formatAnchorText(anchor, entry.value)
  return text === '' ? NO_VALUE_TEXT : text
}

/** 锚点层。一个实例绑一份场景，换模型时 `build` 重建。 */
export class AnchorLayer {
  readonly group = new THREE.Group()
  private readonly host: HTMLElement | null
  private entries: AnchorEntry[] = []
  private geometry: THREE.SphereGeometry | null = null
  private radius = MIN_DOT_RADIUS

  constructor(host: HTMLElement | null) {
    this.host = host
    this.group.name = 'twin-anchors'
  }

  /**
   * 重建全部锚点；`visible` 为假的锚点不建对象。
   * @param anchors 归一化后的锚点
   */
  build(anchors: readonly TwinAnchor[]): void {
    this.clear()
    const shown = anchors.filter((anchor) => anchor.visible)
    if (shown.length === 0) return
    const geometry = new THREE.SphereGeometry(1, DOT_SEGMENTS_H, DOT_SEGMENTS_V)
    this.geometry = geometry
    const color =
      resolveColorSpec(ACCENT_COLOR_TOKEN, this.host) ??
      new THREE.Color(ACCENT_FALLBACK)
    for (const anchor of shown) {
      this.entries.push(this.createEntry(anchor, geometry, color))
    }
    this.applyRadius()
  }

  /**
   * 刷新读数文本。
   * @param values 缝合后的锚点实时值
   */
  setValues(values: TwinAnchorValues): void {
    for (const entry of this.entries) {
      entry.valueEl.textContent = anchorText(entry.anchor, values)
    }
  }

  /**
   * 小球尺寸跟模型体量走，否则大模型上它小成一个点、小模型上糊成一片。
   * @param modelDiagonal 模型包围盒对角线长度
   */
  setWorldScale(modelDiagonal: number): void {
    const usable =
      Number.isFinite(modelDiagonal) && modelDiagonal > 0 ? modelDiagonal : 1
    this.radius = Math.min(
      MAX_DOT_RADIUS,
      Math.max(MIN_DOT_RADIUS, usable * DOT_RADIUS_RATIO),
    )
    this.applyRadius()
  }

  dispose(): void {
    this.clear()
  }

  private createEntry(
    anchor: TwinAnchor,
    geometry: THREE.SphereGeometry,
    color: THREE.Color,
  ): AnchorEntry {
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
    })
    const dot = new THREE.Mesh(geometry, material)
    dot.position.set(...anchor.position)
    dot.renderOrder = ANCHOR_RENDER_ORDER
    const element = document.createElement('div')
    const nameEl = document.createElement('span')
    nameEl.textContent = anchor.name
    const valueEl = document.createElement('span')
    valueEl.textContent = NO_VALUE_TEXT
    element.append(nameEl, valueEl)
    styleLabel(element, valueEl)
    const label = new CSS2DObject(element)
    this.group.add(dot, label)
    return { anchor, dot, label, valueEl }
  }

  private applyRadius(): void {
    for (const entry of this.entries) {
      entry.dot.scale.setScalar(this.radius)
      entry.label.position.copy(entry.dot.position)
      entry.label.position.y += this.radius * LABEL_LIFT
    }
  }

  // ⚠ CSS2D 的 DOM 元素挂在标签层容器里，光从场景图上摘下对象带不走它——
  // 漏了这一步，卸载后标签还留在页面上飘着
  private clear(): void {
    const materials = new Set<THREE.Material>()
    for (const entry of this.entries) {
      entry.label.element.remove()
      this.group.remove(entry.dot, entry.label)
      if (entry.dot.material instanceof THREE.Material) {
        materials.add(entry.dot.material)
      }
    }
    for (const material of materials) material.dispose()
    this.geometry?.dispose()
    this.geometry = null
    this.entries = []
  }
}
