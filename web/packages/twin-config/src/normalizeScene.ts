/**
 * @fileoverview 场景层的归一化：模型摆放、内置动画、场景特效、视点与切换控件。
 */
import {
  boolOr,
  clampedOr,
  entityId,
  oneOf,
  vec3,
  ORIGIN,
} from './normalizeShared'
import {
  isRecord,
  normalizeColorSpec,
  stringList,
  trimmedString,
} from './sanitize'
import {
  TWIN_LIGHT_COLUMN_MODES,
  TWIN_LIGHT_COLUMN_RISES,
  TWIN_PEDESTAL_REFLECTIONS,
  TWIN_VIEWPOINT_MODES,
  type TwinCamera,
  type TwinLightColumn,
  type TwinModelAnimations,
  type TwinModelRef,
  type TwinPedestal,
  type TwinSceneEffects,
  type TwinStarfield,
  type TwinViewpointSwitcher,
} from './types'

const ASSET_REF_PREFIX = 'asset:'
const DEFAULT_SCALE = 1
const MIN_SCALE = 0.001
const MAX_SCALE = 1000
/** 动画速度：0 = 定格，负数是倒放，上限防手滑输成 1000 倍 */
const MIN_ANIM_SPEED = -4
const MAX_ANIM_SPEED = 4
/** 特效的强度类倍率一律收在 [0,2]：超过 2 只会糊成一片白 */
const MAX_EFFECT_SCALE = 2
/** 底座占地相对模型底面的倍数 */
const MIN_PEDESTAL_RADIUS = 0.5
const MAX_PEDESTAL_RADIUS = 8
/** 光柱高度相对模型高度的倍数 */
const MIN_COLUMN_HEIGHT = 0.2
const MAX_COLUMN_HEIGHT = 4
const DEFAULT_ACCENT = '#00d5ff'

/**
 * 透视视野的合法区间。
 * ⚠ three 要求 fov ∈ (0,180)：取到端点时取景距离的公式除零或塌缩成 0，
 * 表现是「切到这个视点画面整个消失」，而没有任何一处报错。
 */
export const MIN_CAMERA_FOV = 1
export const MAX_CAMERA_FOV = 179
export const DEFAULT_CAMERA_FOV = 45

function normalizeAnimations(raw: unknown): TwinModelAnimations {
  const source = isRecord(raw) ? raw : {}
  return {
    enabled: source.enabled === true,
    clips: stringList(source.clips),
    speed: clampedOr(source.speed, 1, MIN_ANIM_SPEED, MAX_ANIM_SPEED),
  }
}

function normalizeStarfield(raw: unknown): TwinStarfield {
  const source = isRecord(raw) ? raw : {}
  return {
    enabled: source.enabled === true,
    density: clampedOr(source.density, 1, 0, MAX_EFFECT_SCALE),
    speed: clampedOr(source.speed, 1, 0, MAX_EFFECT_SCALE),
    nebula: source.nebula === true,
  }
}

function normalizePedestal(raw: unknown): TwinPedestal {
  const source = isRecord(raw) ? raw : {}
  return {
    enabled: source.enabled === true,
    color: normalizeColorSpec(source.color) ?? DEFAULT_ACCENT,
    // ⚠ 这四项缺省开：底座一旦开了，用户要的是「一整套」而不是一个空圆盘
    ring: boolOr(source.ring, true),
    grid: boolOr(source.grid, true),
    gradientGround: boolOr(source.gradientGround, true),
    contactShadow: boolOr(source.contactShadow, true),
    reflection: oneOf(source.reflection, TWIN_PEDESTAL_REFLECTIONS, 'none'),
    radius: clampedOr(
      source.radius,
      1.6,
      MIN_PEDESTAL_RADIUS,
      MAX_PEDESTAL_RADIUS,
    ),
  }
}

function normalizeLightColumn(raw: unknown): TwinLightColumn {
  const source = isRecord(raw) ? raw : {}
  return {
    enabled: source.enabled === true,
    mode: oneOf(source.mode, TWIN_LIGHT_COLUMN_MODES, 'dome'),
    color: normalizeColorSpec(source.color) ?? DEFAULT_ACCENT,
    intensity: clampedOr(source.intensity, 1, 0, MAX_EFFECT_SCALE),
    speed: clampedOr(source.speed, 1, 0, MAX_EFFECT_SCALE),
    // 略高于模型 = 包裹感；等高会把顶盖切平
    height: clampedOr(
      source.height,
      1.15,
      MIN_COLUMN_HEIGHT,
      MAX_COLUMN_HEIGHT,
    ),
    rise: oneOf(source.rise, TWIN_LIGHT_COLUMN_RISES, 'loop'),
  }
}

function normalizeSceneEffects(raw: unknown): TwinSceneEffects {
  const source = isRecord(raw) ? raw : {}
  return {
    starfield: normalizeStarfield(source.starfield),
    pedestal: normalizePedestal(source.pedestal),
    lightColumn: normalizeLightColumn(source.lightColumn),
  }
}

/** 模型引用与摆放。 */
export function normalizeModel(raw: unknown): TwinModelRef {
  const source = isRecord(raw) ? raw : {}
  const asset = trimmedString(source.asset)
  return {
    asset: asset.startsWith(ASSET_REF_PREFIX) ? asset : '',
    scale: clampedOr(source.scale, DEFAULT_SCALE, MIN_SCALE, MAX_SCALE),
    position: vec3(source.position, ORIGIN),
    rotation: vec3(source.rotation, ORIGIN),
    autoRotate: source.autoRotate === true,
    background: normalizeColorSpec(source.background) ?? '',
    showGroundGrid: source.showGroundGrid === true,
    originalMaterials: source.originalMaterials === true,
    animations: normalizeAnimations(source.animations),
    sceneEffects: normalizeSceneEffects(source.sceneEffects),
  }
}

/** 一个视点。 */
export function normalizeCamera(
  raw: unknown,
  index: number,
): TwinCamera | null {
  if (!isRecord(raw)) return null
  return {
    id: entityId(raw.id, 'camera', index),
    name: trimmedString(raw.name),
    position: vec3(raw.position, ORIGIN),
    target: vec3(raw.target, ORIGIN),
    fov: clampedOr(raw.fov, DEFAULT_CAMERA_FOV, MIN_CAMERA_FOV, MAX_CAMERA_FOV),
    isDefault: raw.isDefault === true,
  }
}

/** 视点切换控件。 */
export function normalizeViewpoints(raw: unknown): TwinViewpointSwitcher {
  const source = isRecord(raw) ? raw : {}
  return {
    enabled: source.enabled === true,
    mode: oneOf(source.mode, TWIN_VIEWPOINT_MODES, 'buttons'),
    keyboard: source.keyboard === true,
    items: stringList(source.items),
  }
}

/**
 * 打开大屏时用的机位；一个都没标默认就用文档序第一个，一个视点都没有给 null。
 * ⚠ 多个都标了只认第一个：让「最后一个赢」会让人在列表里改顺序时莫名换镜头。
 * @param cameras 归一化后的视点
 */
export function defaultCameraOf(
  cameras: readonly TwinCamera[],
): TwinCamera | null {
  return cameras.find((item) => item.isDefault) ?? cameras[0] ?? null
}
