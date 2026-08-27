/**
 * @fileoverview 部件外观与状态染色的归一化。
 *
 * ⚠ 「没配染色」与「配了一条空规则」必须分得开：`tint` 为 null 时这个部件
 * **不占绑定行**，而 `{ mode: 'stops', stops: [] }` 是「取数但一档都没命中」。
 * 把前者归一成后者会凭空多出一行绑定，而它绑上点位也永远不会有任何效果。
 * ⚠ 档位的**顺序**是配置的一部分（自上而下取第一个命中的），这里只清洗不重排。
 */
import { normalizePanelField, MAX_PANEL_COLUMNS } from './normalizeElements'
import { normalizeFocusView } from './normalizeScene'
import {
  boolOr,
  clampedOr,
  entityId,
  normalizeList,
  oneOf,
} from './normalizeShared'
import {
  isRecord,
  normalizeColorSpec,
  toFiniteNumber,
  trimmedString,
} from './sanitize'
import {
  TWIN_PANEL_VARIANTS,
  TWIN_PART_FAR_ACTIONS,
  TWIN_PART_NEAR_ACTIONS,
  TWIN_TINT_MATCHES,
  TWIN_TINT_MODES,
  type TwinPartClick,
  type TwinPartDetail,
  type TwinPartLook,
  type TwinPartTint,
  type TwinTintGradient,
  type TwinTintStop,
} from './types'

/** 常态染色浓度：染上去还看得出金属/纹理，不至于糊成一块纯色。 */
const DEFAULT_BLEND = 0.85
/** 自发光上限；再高只是把画面烧白。 */
const MAX_GLOW = 3
/** 渐变缺省区间，配成 0–100 让百分比类点位开箱即用。 */
export const DEFAULT_TINT_GRADIENT: TwinTintGradient = Object.freeze({
  min: 0,
  max: 100,
  from: '--state-success',
  to: '--state-danger',
})

/** 一条都没配的常态外观：完全按模型自带的材质走。 */
export const DEFAULT_PART_LOOK: TwinPartLook = Object.freeze({
  opacity: 1,
  color: '',
  blend: DEFAULT_BLEND,
  glow: 0,
})

/**
 * 颜色规格；解析不出来一律空串（= 不染色）。
 * ⚠ 不回落到某个默认色：回落会让「token 名写错了」看起来像「配对了」，
 * 而 3D 画面上没有任何别的迹象能提示这一点。
 */
function colorSpec(raw: unknown): string {
  return normalizeColorSpec(raw) ?? ''
}

/**
 * 部件常态外观。
 * @param raw 落库的外观
 */
export function normalizePartLook(raw: unknown): TwinPartLook {
  if (!isRecord(raw)) return { ...DEFAULT_PART_LOOK }
  return {
    opacity: clampedOr(raw.opacity, 1, 0, 1),
    color: colorSpec(raw.color),
    blend: clampedOr(raw.blend, DEFAULT_BLEND, 0, 1),
    glow: clampedOr(raw.glow, 0, 0, MAX_GLOW),
  }
}

/**
 * 一档取色。
 * ⚠ 颜色空着的档位**照样保留**：它的意思是「命中这一档就保持原色」，
 * 与「没有这一档」不同——有它才能截住后面的档位。
 */
function normalizeStop(raw: unknown, index: number): TwinTintStop | null {
  if (!isRecord(raw)) return null
  return {
    id: entityId(raw.id, 'stop', index),
    match: oneOf(raw.match, TWIN_TINT_MATCHES, 'range'),
    from: toFiniteNumber(raw.from),
    to: toFiniteNumber(raw.to),
    equals: trimmedString(raw.equals),
    color: colorSpec(raw.color),
    label: trimmedString(raw.label),
  }
}

function normalizeGradient(raw: unknown): TwinTintGradient {
  if (!isRecord(raw)) return { ...DEFAULT_TINT_GRADIENT }
  return {
    min: toFiniteNumber(raw.min) ?? DEFAULT_TINT_GRADIENT.min,
    max: toFiniteNumber(raw.max) ?? DEFAULT_TINT_GRADIENT.max,
    from: colorSpec(raw.from) || DEFAULT_TINT_GRADIENT.from,
    to: colorSpec(raw.to) || DEFAULT_TINT_GRADIENT.to,
  }
}

/**
 * 部件的状态染色规则；不是对象即「这个部件不取数」。
 * @param raw 落库的规则
 */
export function normalizePartTint(raw: unknown): TwinPartTint | null {
  if (!isRecord(raw)) return null
  return {
    mode: oneOf(raw.mode, TWIN_TINT_MODES, 'stops'),
    stops: normalizeList(raw.stops, normalizeStop),
    gradient: normalizeGradient(raw.gradient),
    fallback: colorSpec(raw.fallback),
  }
}

/** 弹窗里那块 3D 的高度区间 px；太矮的话一个设备也摆不下。 */
const MIN_MODEL_HEIGHT = 120
const MAX_MODEL_HEIGHT = 720
/** 弹窗宽度区间 px。 */
const MIN_MODAL_WIDTH = 320
const MAX_MODAL_WIDTH = 1200

/**
 * 一条都没配的点击动作。
 * ⚠ 远距是 `approach`（先把部件框进画面），与两段式点击本来的行为一致；
 * 近距是 `none`：缺省就弹窗的话，一份还没配过详情字段的配置会在每次点击部件时
 * 弹出一张空卡片。
 */
export const DEFAULT_PART_CLICK: TwinPartClick = Object.freeze({
  far: 'approach',
  near: 'none',
  view: null,
  cameraId: '',
})

/** 一条都没配的详情弹窗。 */
export const DEFAULT_PART_DETAIL: TwinPartDetail = Object.freeze({
  title: '',
  subtitle: '',
  fields: [],
  showModel: true,
  autoRotate: true,
  modelHeight: 260,
  width: 720,
  variant: 'card',
  accent: '',
  columns: 1,
})

/**
 * 部件的点击动作。
 * ⚠ 远距缺省是 `approach`（先把部件框进画面），与两段式点击本来的行为一致；
 * 近距缺省是 `none`：缺省就弹窗的话，一份还没配过详情字段的配置会在每次点击
 * 部件时弹出一张空卡片。
 * @param raw 落库的点击动作
 */
export function normalizePartClick(raw: unknown): TwinPartClick {
  if (!isRecord(raw)) return { ...DEFAULT_PART_CLICK }
  return {
    far: oneOf(raw.far, TWIN_PART_FAR_ACTIONS, DEFAULT_PART_CLICK.far),
    near: oneOf(raw.near, TWIN_PART_NEAR_ACTIONS, DEFAULT_PART_CLICK.near),
    view: normalizeFocusView(raw.view),
    cameraId: trimmedString(raw.cameraId),
  }
}

/**
 * 部件详情弹窗。
 * ⚠ 一个字段都没有也照样产出一份详情：字段是不是空由 `fields.length` 说了算，
 * 用 null 表达「没配」会多出一处口径，而两处口径不一致就是绑定行整片错位。
 * @param raw 落库的详情
 */
export function normalizePartDetail(raw: unknown): TwinPartDetail {
  const source = isRecord(raw) ? raw : {}
  return {
    title: trimmedString(source.title),
    subtitle: trimmedString(source.subtitle),
    fields: normalizeList(source.fields, normalizePanelField),
    showModel: boolOr(source.showModel, DEFAULT_PART_DETAIL.showModel),
    autoRotate: boolOr(source.autoRotate, DEFAULT_PART_DETAIL.autoRotate),
    modelHeight: clampedOr(
      source.modelHeight,
      DEFAULT_PART_DETAIL.modelHeight,
      MIN_MODEL_HEIGHT,
      MAX_MODEL_HEIGHT,
    ),
    width: clampedOr(
      source.width,
      DEFAULT_PART_DETAIL.width,
      MIN_MODAL_WIDTH,
      MAX_MODAL_WIDTH,
    ),
    variant: oneOf(
      source.variant,
      TWIN_PANEL_VARIANTS,
      DEFAULT_PART_DETAIL.variant,
    ),
    accent: colorSpec(source.accent),
    columns: clampedOr(source.columns, 1, 1, MAX_PANEL_COLUMNS),
  }
}
