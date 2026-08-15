/**
 * @fileoverview 信息牌层：锚定在锚点或世界坐标上的一张 CSS2D 卡片。
 *
 * ⚠ 全部文本走 `textContent`——牌名、字段标签、单位与静态文案都是用户可控文本，
 * 拼进 `innerHTML` 就是一个注入点（code-style-typescript §10）。
 * ⚠ 本层不建任何 GPU 几何：卡片是 DOM。要清的只有 DOM，但它一定要清——
 * 从场景图上摘下 CSS2D 对象带不走它的元素。
 */
import type {
  TwinAnchor,
  TwinPanel,
  TwinPanelField,
  TwinPanelValues,
  Vec3,
} from '@dt/twin-config'
import { EMPTY_PANEL_VALUES, formatValueText } from '@dt/twin-config'
import * as THREE from 'three'
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js'

import { distanceResolver, type DistanceContext } from './distanceContext'
import { resolveVisibility } from './distanceRules'

/** 没有读数、也没有静态文案时的占位符 */
const NO_VALUE_TEXT = '—'

interface FieldEntry {
  field: TwinPanelField
  valueKey: string
  valueEl: HTMLElement
}

interface PanelEntry {
  panel: TwinPanel
  label: CSS2DObject
  fields: FieldEntry[]
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

/** 一个字段当前该显示什么：有实时值用实时值，没有就退回静态文案。 */
function fieldText(entry: FieldEntry, values: TwinPanelValues): string {
  const live = values[entry.valueKey]
  if (live !== undefined) {
    const text = formatValueText(entry.field, live.value)
    if (text !== '') return text
  }
  return entry.field.staticText === '' ? NO_VALUE_TEXT : entry.field.staticText
}

function styleCard(element: HTMLElement, panel: TwinPanel): void {
  const { style } = panel
  element.style.display = 'flex'
  element.style.flexDirection = 'column'
  element.style.gap = '4px'
  element.style.padding = '8px 10px'
  element.style.borderRadius = 'var(--radius-md)'
  element.style.border = `1px solid ${cssColor(style.accent)}`
  element.style.background =
    style.background === '' ? 'var(--surface-overlay)' : cssColor(style.background)
  element.style.color = 'var(--text-primary)'
  element.style.fontSize = `${(11 * style.fontScale).toFixed(1)}px`
  element.style.lineHeight = '1.5'
  element.style.whiteSpace = 'nowrap'
  element.style.userSelect = 'none'
  if (style.width > 0) element.style.width = `${style.width}px`
  // 变体只改一个 data 属性，具体观感交给样式表——层里不堆五份内联样式
  element.dataset.variant = style.variant
  element.dataset.orient = style.orient
  if (style.pulse) element.dataset.pulse = 'on'
  if (style.animate) element.dataset.animate = 'on'
}

/** 色规格 → 能写进 style 的字符串；token 要包一层 `var()`。 */
function cssColor(spec: string): string {
  return spec.startsWith('--') ? `var(${spec})` : spec
}

function buildRow(field: TwinPanelField): {
  row: HTMLElement
  valueEl: HTMLElement
} {
  const row = document.createElement('div')
  row.style.display = 'flex'
  row.style.justifyContent = 'space-between'
  row.style.gap = '12px'
  const labelEl = document.createElement('span')
  labelEl.textContent = field.label
  labelEl.style.color = 'var(--text-secondary)'
  const valueEl = document.createElement('span')
  valueEl.textContent = NO_VALUE_TEXT
  valueEl.style.fontWeight = '700'
  valueEl.style.fontVariantNumeric = 'tabular-nums'
  row.append(labelEl, valueEl)
  return { row, valueEl }
}

/** 信息牌层。一个实例绑一份场景，换配置时 `build` 重建。 */
export class PanelLayer {
  readonly group = new THREE.Group()
  private entries: PanelEntry[] = []

  constructor() {
    this.group.name = 'twin-panels'
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
      for (const field of entry.fields) {
        field.valueEl.textContent = fieldText(field, values)
      }
    }
  }

  /**
   * 按这一帧的取景状态更新显隐与淡出。
   * ⚠ 卡片是 CSS2D，靠 `object.visible` 隐藏（CSS2DRenderer 会跟着把元素
   * `display: none`）；不透明度只能落在元素的 style 上，材质那条路这里没有。
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
    const element = document.createElement('div')
    styleCard(element, panel)
    if (panel.name !== '') {
      const title = document.createElement('div')
      title.textContent = panel.name
      title.style.color = cssColor(panel.style.accent)
      title.style.fontWeight = '700'
      element.append(title)
    }
    const fields: FieldEntry[] = []
    for (const field of panel.fields) {
      const { row, valueEl } = buildRow(field)
      element.append(row)
      fields.push({ field, valueKey: `${panel.id}::${field.key}`, valueEl })
    }
    const label = new CSS2DObject(element)
    label.position.set(...positionOf(panel, anchors))
    this.group.add(label)
    return { panel, label, fields }
  }

  // ⚠ CSS2D 的 DOM 元素挂在标签层容器里，从场景图上摘下对象带不走它——
  // 漏了这一步，卸载后卡片还留在页面上飘着
  private clear(): void {
    for (const entry of this.entries) {
      entry.label.element.remove()
      this.group.remove(entry.label)
    }
    this.entries = []
  }
}
