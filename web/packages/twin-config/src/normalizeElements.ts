/**
 * @fileoverview 三类带值元素的归一化：信息牌、立体箭头、能量流。
 *
 * ⚠ 三者的实时值都走**数组绑定按文档序对齐**，所以这里产出的顺序就是取值的
 * 行号。插一个元素会让它之后的每一行整体后移一格——编辑器改完必须重派绑定行。
 */
import {
  clampedOr,
  entityId,
  normalizeList,
  oneOf,
  vec3,
  ORIGIN,
} from './normalizeShared'
import { normalizeVisibility } from './normalizeRules'
import {
  isRecord,
  normalizeColorSpec,
  stringList,
  toFiniteNumber,
  trimmedString,
} from './sanitize'
import {
  TWIN_BILLBOARD_MODES,
  TWIN_PANEL_ORIENTS,
  TWIN_PANEL_VARIANTS,
  type TwinArrow,
  type TwinFlowLink,
  type TwinPanel,
  type TwinPanelField,
  type TwinPanelStyle,
  type Vec3,
} from './types'

const MAX_DECIMALS = 10
/** 卡片宽度 0 = 自适应；上限防手滑输成一屏宽 */
const MAX_PANEL_WIDTH = 1200
const MIN_FONT_SCALE = 0.5
const MAX_FONT_SCALE = 3
/** 箭头与流的几何倍率：负数与零都画不出东西 */
const MIN_GEOMETRY = 0.01
const MAX_GEOMETRY = 100
const DEFAULT_ACCENT = '--accent-primary'

/** 小数位：四舍五入并夹进上限；取不到即「不定位数」。 */
function decimalsOf(raw: unknown): number | null {
  const parsed = toFiniteNumber(raw)
  return parsed === null
    ? null
    : clampedOr(Math.round(parsed), 0, 0, MAX_DECIMALS)
}

function normalizePanelStyle(raw: unknown): TwinPanelStyle {
  const source = isRecord(raw) ? raw : {}
  return {
    variant: oneOf(source.variant, TWIN_PANEL_VARIANTS, 'card'),
    orient: oneOf(source.orient, TWIN_PANEL_ORIENTS, 'center'),
    accent: normalizeColorSpec(source.accent) ?? DEFAULT_ACCENT,
    background: normalizeColorSpec(source.background) ?? '',
    width: clampedOr(source.width, 0, 0, MAX_PANEL_WIDTH),
    fontScale: clampedOr(source.fontScale, 1, MIN_FONT_SCALE, MAX_FONT_SCALE),
    animate: source.animate === true,
    pulse: source.pulse === true,
  }
}

function normalizePanelField(
  raw: unknown,
  index: number,
): TwinPanelField | null {
  if (!isRecord(raw)) return null
  return {
    key: entityId(raw.key, 'field', index),
    label: trimmedString(raw.label),
    unit: trimmedString(raw.unit),
    prefix: trimmedString(raw.prefix),
    decimals: decimalsOf(raw.decimals),
    staticText: trimmedString(raw.staticText),
  }
}

/** 一张信息牌。 */
export function normalizePanel(raw: unknown, index: number): TwinPanel | null {
  if (!isRecord(raw)) return null
  return {
    id: entityId(raw.id, 'panel', index),
    name: trimmedString(raw.name),
    anchorId: trimmedString(raw.anchorId),
    position: vec3(raw.position, ORIGIN),
    offset: vec3(raw.offset, ORIGIN),
    fields: normalizeList(raw.fields, normalizePanelField),
    billboard: oneOf(raw.billboard, TWIN_BILLBOARD_MODES, 'face'),
    style: normalizePanelStyle(raw.style),
    visibility: normalizeVisibility(raw.visibility, raw.visible),
  }
}

/** 朝上的缺省方向。 */
const UP: Vec3 = [0, 1, 0]

/**
 * 箭头朝向。
 * ⚠ 零向量在这里就换成 +Y，不留给渲染层：`normalize()` 一个零向量得到的是
 * NaN，整个箭头连同它的标签会从画面上消失，而控制台一声不吭。
 */
function usableDirection(raw: unknown): Vec3 {
  const built = vec3(raw, UP)
  const isZero = built.every((axis) => axis === 0)
  return isZero ? [...UP] : built
}

/** 一个立体箭头。 */
export function normalizeArrow(raw: unknown, index: number): TwinArrow | null {
  if (!isRecord(raw)) return null
  return {
    id: entityId(raw.id, 'arrow', index),
    name: trimmedString(raw.name),
    position: vec3(raw.position, ORIGIN),
    direction: usableDirection(raw.direction),
    length: clampedOr(raw.length, 1, MIN_GEOMETRY, MAX_GEOMETRY),
    width: clampedOr(raw.width, 1, MIN_GEOMETRY, MAX_GEOMETRY),
    labelText: trimmedString(raw.labelText),
    prefix: trimmedString(raw.prefix),
    unit: trimmedString(raw.unit),
    decimals: decimalsOf(raw.decimals),
    color: normalizeColorSpec(raw.color) ?? DEFAULT_ACCENT,
    visibility: normalizeVisibility(raw.visibility, raw.visible),
  }
}

/** 一条能量流。 */
export function normalizeFlow(
  raw: unknown,
  index: number,
): TwinFlowLink | null {
  if (!isRecord(raw)) return null
  return {
    id: entityId(raw.id, 'flow', index),
    name: trimmedString(raw.name),
    kind: trimmedString(raw.kind),
    pathAnchors: stringList(raw.pathAnchors),
    width: clampedOr(raw.width, 1, MIN_GEOMETRY, MAX_GEOMETRY),
    reversible: raw.reversible === true,
    visibility: normalizeVisibility(raw.visibility, raw.visible),
  }
}

/** 信息牌字段在整份配置里的位置：牌 + 字段 + 扁平化后的行号。 */
export interface FlatPanelField {
  panelId: string
  field: TwinPanelField
  /** `<牌 id>::<字段 key>`，实时值按它索引。 */
  valueKey: string
}

/**
 * 把所有信息牌的字段按文档序摊平。
 * ⚠ 这个顺序就是 `panelValues` 的行号：派生绑定行与缝合读值必须都用它，
 * 各算各的会让每一行都有值、但全都接错了字段。
 * @param panels 归一化后的信息牌
 */
export function flattenPanelFields(
  panels: readonly TwinPanel[],
): FlatPanelField[] {
  return panels.flatMap((panel) =>
    panel.fields.map((field) => ({
      panelId: panel.id,
      field,
      valueKey: `${panel.id}::${field.key}`,
    })),
  )
}
