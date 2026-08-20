/**
 * @fileoverview 场景层的归一化：模型摆放、内置动画、场景特效、视点、切换控件与
 * 自动漫游轨迹。
 */
import { MODEL_VARIANTS } from '@dt/contracts'
import type { ModelVariant } from '@dt/contracts'

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
  toFiniteNumber,
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
  type TwinRoamTour,
  type TwinRoamTourSegment,
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
    // ⚠ 存量配置里没有这个字段，缺省必须是 `original`：给成别的档，既有大屏
    // 会在这次发布之后集体去取一份可能还不存在的派生件
    variant: oneOf<ModelVariant>(source.variant, MODEL_VARIANTS, 'original'),
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
 * 漫游的两段时长与闲置延时的缺省与上限，ms。
 * ⚠ 上限不是排版洁癖：一段配到几分钟时，用户只会看到「镜头卡住不动了」，
 * 而画面上没有任何东西说明它其实正在以极慢的速度飞。
 */
export const DEFAULT_ROAM_TOUR_SEGMENT_MS = 1800
export const MAX_ROAM_TOUR_SEGMENT_MS = 30000
export const DEFAULT_ROAM_TOUR_PAUSE_MS = 0
export const MAX_ROAM_TOUR_PAUSE_MS = 10000
export const DEFAULT_ROAM_TOUR_IDLE_DELAY_MS = 180000
export const MAX_ROAM_TOUR_IDLE_DELAY_MS = 3600000

/** 一条轨迹至少要这么多个可用视点才飞得起来。 */
export const MIN_ROAM_TOUR_STOPS = 2

/** 可缺省的毫秒数：取不到给 null（= 用全局值），取到就取整并夹进 [0, max]。 */
function optionalMs(value: unknown, max: number): number | null {
  const parsed = toFiniteNumber(value)
  return parsed === null ? null : clampedOr(Math.round(parsed), 0, 0, max)
}

/** 一段的时长覆盖；两项都没配返回 null，让这条覆盖整个从表里消失。 */
function normalizeRoamSegment(raw: unknown): TwinRoamTourSegment | null {
  if (!isRecord(raw)) return null
  const segmentMs = optionalMs(raw.segmentMs, MAX_ROAM_TOUR_SEGMENT_MS)
  const pauseMs = optionalMs(raw.pauseMs, MAX_ROAM_TOUR_PAUSE_MS)
  return segmentMs === null && pauseMs === null ? null : { segmentMs, pauseMs }
}

function normalizeSegmentSettings(
  raw: unknown,
): Record<string, TwinRoamTourSegment> {
  if (!isRecord(raw)) return {}
  const out: Record<string, TwinRoamTourSegment> = {}
  for (const [key, value] of Object.entries(raw)) {
    const id = key.trim()
    const segment = normalizeRoamSegment(value)
    if (id !== '' && segment !== null) out[id] = segment
  }
  return out
}

/**
 * 自动漫游轨迹。
 * ⚠ `items` 里指向已删视点的 id **不在这里剔除**：归一化只管形状，悬空引用一律
 * 留着由 `collectTwinConfigIssues` 报出来，与视点切换、信息牌锚点同一个口径。
 * 静默清掉的话，用户只会看到轨迹凭空少了两站而没有任何提示。
 * ⚠ 逐段覆盖的键同样不与 `items` 对账：把一个视点暂时挪出轨迹，不该顺手抹掉
 * 它那一段配好的时长。
 * @param raw 落库的 roamTour 块
 */
export function normalizeRoamTour(raw: unknown): TwinRoamTour {
  const source = isRecord(raw) ? raw : {}
  return {
    enabled: source.enabled === true,
    autoplay: source.autoplay === true,
    idleAutoplay: source.idleAutoplay === true,
    idleAutoplayDelayMs: clampedOr(
      source.idleAutoplayDelayMs,
      DEFAULT_ROAM_TOUR_IDLE_DELAY_MS,
      0,
      MAX_ROAM_TOUR_IDLE_DELAY_MS,
    ),
    // 这两项缺省开：轨迹配出来就是要循环播、要能让人按停的
    loop: boolOr(source.loop, true),
    showControls: boolOr(source.showControls, true),
    // ⚠ 同一个视点在轨迹里只留第一次出现：逐段覆盖按视点 id 索引，
    // 允许重复会让两段抢同一条覆盖
    items: stringList(source.items),
    segmentMs: clampedOr(
      source.segmentMs,
      DEFAULT_ROAM_TOUR_SEGMENT_MS,
      0,
      MAX_ROAM_TOUR_SEGMENT_MS,
    ),
    pauseMs: clampedOr(
      source.pauseMs,
      DEFAULT_ROAM_TOUR_PAUSE_MS,
      0,
      MAX_ROAM_TOUR_PAUSE_MS,
    ),
    segmentSettings: normalizeSegmentSettings(source.segmentSettings),
  }
}
