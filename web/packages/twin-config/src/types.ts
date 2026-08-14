/**
 * @fileoverview 孪生场景配置的类型与容错归一化。
 * 归一化只管形状——缺字段给缺省、非法值丢弃、非有限数按缺省顶上，从不抛错；
 * 跨实体的悬空引用交给 `collectTwinConfigIssues` 响亮报出（ADR-0012 四）。
 */
import { TWIN_CONFIG_VERSION } from './constants'
import {
  clamp,
  finiteOr,
  isRecord,
  normalizeColorSpec,
  normalizeHexColor,
  stringList,
  toArray,
  toFiniteNumber,
  trimmedString,
} from './sanitize'

/** 世界坐标 / 欧拉角三元组。 */
export type Vec3 = [number, number, number]

/**
 * 模型引用与它在场景里的摆放。
 * `asset` 是素材引用 `asset:<uuid>`（ADR-0022 的唯一合法落库形态），空串 = 还没挑模型。
 */
export interface TwinModelRef {
  asset: string
  scale: number
  position: Vec3
  /** 欧拉角，度。 */
  rotation: Vec3
  autoRotate: boolean
  /** 背景色规格；空串 = 透明。 */
  background: string
}

/**
 * 部件：模型内一组节点的唯一可寻址单元，显隐与染色都指向它。
 * ⚠ `nodes` 是模型文件里的对象名，本包看不见模型——模型里改了名字，
 * 这个部件就静默地什么都不再命中。
 */
export interface TwinPart {
  id: string
  name: string
  nodes: string[]
  visible: boolean
}

/** 锚点：世界坐标上的一个读数标签。 */
export interface TwinAnchor {
  id: string
  name: string
  position: Vec3
  /** 读数前缀；空串 = 只显示数值。 */
  label: string
  unit: string
  /** 小数位；null = 不定位数，按原值上屏。 */
  decimals: number | null
  visible: boolean
}

/** 染色取色模式。 */
export const TWIN_TINT_MODES = ['status', 'gradient'] as const
export type TwinTintMode = (typeof TWIN_TINT_MODES)[number]

/** gradient 模式的数值区间与两端颜色。两端只认 hex——token 要到宿主里才有值，插不了值。 */
export interface TwinTintGradient {
  lo: string
  hi: string
  min: number
  max: number
}

/**
 * 状态染色规则：把若干**部件**按实时状态或数值染色。
 * ⚠ 目标只用 `partIds` 一种寻址；再开一条直写模型节点名的路，两套寻址一定会漂。
 */
export interface TwinTintRule {
  id: string
  name: string
  partIds: string[]
  mode: TwinTintMode
  /** status 值 → 颜色规格。 */
  statusColors: Record<string, string>
  gradient: TwinTintGradient | null
  /** 命中即告警，大小写不敏感。 */
  alarmStatus: string[]
}

/** 一份孪生场景配置。 */
export interface TwinConfig {
  version: number
  model: TwinModelRef
  parts: TwinPart[]
  anchors: TwinAnchor[]
  tints: TwinTintRule[]
}

/** 一条染色规则的实时值。 */
export interface TwinTintValue {
  value: unknown
  status: unknown
}

/** 染色实时值，按规则 id 索引。 */
export type TwinTintValues = Readonly<Record<string, TwinTintValue>>

/** 一个锚点的实时值。 */
export interface TwinAnchorValue {
  value: unknown
}

/** 锚点实时值，按锚点 id 索引。 */
export type TwinAnchorValues = Readonly<Record<string, TwinAnchorValue>>

const ASSET_REF_PREFIX = 'asset:'
const ORIGIN: Vec3 = [0, 0, 0]
const DEFAULT_SCALE = 1
const MIN_SCALE = 0.001
const MAX_SCALE = 1000
const MAX_DECIMALS = 10
const DEFAULT_GRADIENT_MIN = 0
const DEFAULT_GRADIENT_MAX = 100

function vec3(value: unknown, fallback: Vec3): Vec3 {
  const items = toArray(value)
  return [
    finiteOr(items[0], fallback[0]),
    finiteOr(items[1], fallback[1]),
    finiteOr(items[2], fallback[2]),
  ]
}

/** 实体 id：缺失或空白时按下标铸一个，同一份输入永远得到同一个 id。 */
function entityId(value: unknown, prefix: string, index: number): string {
  const id = trimmedString(value)
  return id === '' ? `${prefix}-${index}` : id
}

function normalizeModel(raw: unknown): TwinModelRef {
  const source = isRecord(raw) ? raw : {}
  const asset = trimmedString(source.asset)
  return {
    asset: asset.startsWith(ASSET_REF_PREFIX) ? asset : '',
    scale: clamp(finiteOr(source.scale, DEFAULT_SCALE), MIN_SCALE, MAX_SCALE),
    position: vec3(source.position, ORIGIN),
    rotation: vec3(source.rotation, ORIGIN),
    autoRotate: source.autoRotate === true,
    background: normalizeColorSpec(source.background) ?? '',
  }
}

function normalizePart(raw: unknown, index: number): TwinPart | null {
  if (!isRecord(raw)) return null
  return {
    id: entityId(raw.id, 'part', index),
    name: trimmedString(raw.name),
    nodes: stringList(raw.nodes),
    visible: raw.visible !== false,
  }
}

function normalizeAnchor(raw: unknown, index: number): TwinAnchor | null {
  if (!isRecord(raw)) return null
  const decimals = toFiniteNumber(raw.decimals)
  return {
    id: entityId(raw.id, 'anchor', index),
    name: trimmedString(raw.name),
    position: vec3(raw.position, ORIGIN),
    label: trimmedString(raw.label),
    unit: trimmedString(raw.unit),
    decimals:
      decimals === null ? null : clamp(Math.round(decimals), 0, MAX_DECIMALS),
    visible: raw.visible !== false,
  }
}

function normalizeStatusColors(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (!isRecord(raw)) return out
  for (const [key, value] of Object.entries(raw)) {
    const status = key.trim()
    const spec = normalizeColorSpec(value)
    if (status !== '' && spec !== null) out[status] = spec
  }
  return out
}

/** 两端颜色缺一即整块作废——半个区间插不出颜色，留着只会假装配好了。 */
function normalizeGradient(raw: unknown): TwinTintGradient | null {
  if (!isRecord(raw)) return null
  const lo = normalizeHexColor(raw.lo)
  const hi = normalizeHexColor(raw.hi)
  if (lo === null || hi === null) return null
  return {
    lo,
    hi,
    min: finiteOr(raw.min, DEFAULT_GRADIENT_MIN),
    max: finiteOr(raw.max, DEFAULT_GRADIENT_MAX),
  }
}

function normalizeTint(raw: unknown, index: number): TwinTintRule | null {
  if (!isRecord(raw)) return null
  return {
    id: entityId(raw.id, 'tint', index),
    name: trimmedString(raw.name),
    partIds: stringList(raw.partIds),
    mode: raw.mode === 'gradient' ? 'gradient' : 'status',
    statusColors: normalizeStatusColors(raw.statusColors),
    gradient: normalizeGradient(raw.gradient),
    alarmStatus: stringList(raw.alarmStatus),
  }
}

function normalizeList<T>(
  raw: unknown,
  each: (item: unknown, index: number) => T | null,
): T[] {
  const out: T[] = []
  toArray(raw).forEach((item, index) => {
    const normalized = each(item, index)
    if (normalized !== null) out.push(normalized)
  })
  return out
}

/**
 * 任意来源的 JSON → 合法 TwinConfig。渲染层与编辑器的唯一入口。
 * ⚠ 幂等：`normalizeTwinConfig(normalizeTwinConfig(x))` 与一次的结果逐字段相同——
 * 铸 id 只用下标、颜色与数字的归一都收敛，且输出里没有 `undefined`（JSON 往返也不变形）。
 * 数组绑定行的文档序对齐口径以它的输出为准。
 */
export function normalizeTwinConfig(raw: unknown): TwinConfig {
  const source = isRecord(raw) ? raw : {}
  return {
    version: TWIN_CONFIG_VERSION,
    model: normalizeModel(source.model),
    parts: normalizeList(source.parts, normalizePart),
    anchors: normalizeList(source.anchors, normalizeAnchor),
    tints: normalizeList(source.tints, normalizeTint),
  }
}
