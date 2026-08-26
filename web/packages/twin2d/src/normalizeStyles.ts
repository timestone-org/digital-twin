/**
 * @fileoverview 样式面的归一化：节点样式与连线样式，以及它们里面的端口、槽位与变体。
 * 图元树交给 `normalizePrims`，算式与条件两门小语言交给 `normalizeExprs`。
 * 口径见 docs/MODULE_TWIN_2D_DESIGN.md §4.4–§4.6、§6.3 与 §7.9。
 */
import {
  TWIN_2D_DEFAULT_CORNER_RADIUS,
  TWIN_2D_DEFAULT_PLACEHOLDER,
} from './constants'
import {
  TWIN_2D_DEFAULT_STATUSES,
  TWIN_2D_EDGE_MARKER_KINDS,
  TWIN_2D_EDGE_ROUTES,
  TWIN_2D_PORT_AT_KINDS,
  TWIN_2D_PORT_DIRS,
  TWIN_2D_PORT_SIDES,
  TWIN_2D_SLOT_KINDS,
} from './kinds'
import { normalizeCondition, normalizeExpr } from './normalizeExprs'
import {
  normalizePaint,
  normalizeShadows,
  normalizeStrokes,
  unitOr,
} from './normalizePaint'
import {
  normalizeBorder,
  normalizeFont,
  normalizePad,
  normalizeRadius,
} from './normalizePieces'
import { normalizePrimPatch, normalizePrims } from './normalizePrims'
import { normalizeShape } from './normalizeShape'
import {
  boolOr,
  clamp,
  finiteOr,
  idOf,
  isRecord,
  oneOf,
  posDim,
  toArray,
  toFiniteNumber,
  trimmedString,
  uniqueBy,
} from './sanitize'
import { BINDING_DATA_TYPES } from '@dt/contracts'
import type {
  Twin2dPrimPatch,
  Twin2dRootPatch,
  Twin2dStrokePass,
} from './typesPrim'
import type {
  Twin2dEdgeFlow,
  Twin2dEdgeInactive,
  Twin2dEdgeLabel,
  Twin2dEdgeMarker,
  Twin2dEdgeStyle,
  Twin2dNodeStyle,
  Twin2dPinMarker,
  Twin2dPort,
  Twin2dPortAt,
  Twin2dSlot,
  Twin2dVariant,
} from './types'

/** 小数位上限 */
const MAX_SLOT_PRECISION = 6
/** 参考项目的节点缺省宽 */
const DEFAULT_STYLE_WIDTH = 160
/** 参考项目的节点缺省高 */
const DEFAULT_STYLE_HEIGHT = 90
/** 引脚短横线伸出长度（设计像素） */
const DEFAULT_PIN_LENGTH = 8
/** §7.9 #62 的导线：2px、圆头圆角、描边不随舞台缩放 */
const DEFAULT_EDGE_STROKE: Twin2dStrokePass = Object.freeze({
  id: 'stroke-0',
  width: 2,
  color: 'currentColor',
  dash: Object.freeze([]),
  cap: 'round',
  join: 'round',
  opacity: 1,
  nonScaling: true,
})
/** 引脚短横线：与导线同宽，随舞台缩放 */
const DEFAULT_PIN_STROKE: Twin2dStrokePass = Object.freeze({
  id: 'stroke-0',
  width: 2,
  color: 'currentColor',
  dash: Object.freeze([]),
  cap: 'butt',
  join: 'miter',
  opacity: 1,
  nonScaling: false,
})
/** §7.9 #67 的一个完整流动周期 */
const DEFAULT_FLOW_DASH: readonly number[] = Object.freeze([10, 10])
/** §7.9 #67 的 0.8s 基准时长 */
const DEFAULT_FLOW_DURATION_MS = 800
/** §7.9 #65 的箭头尺寸 */
const DEFAULT_ARROW_SIZE = 10
/** §7.9 #65 的箭头张开半角（弧度） */
const DEFAULT_ARROW_SPREAD = 0.42
/** §7.9 #65 的箭头透明度 */
const DEFAULT_ARROW_OPACITY = 0.82
/** 张开半角下界，再小箭头退化成一根线 */
const MIN_ARROW_SPREAD = 0.05
/** 张开半角上界，再大箭头翻成扇形 */
const MAX_ARROW_SPREAD = Math.PI / 2
/** §7.9 #68 的非活跃边透明度 */
const DEFAULT_INACTIVE_OPACITY = 0.5

const EMPTY_ENUM_MAP: Readonly<Record<string, string>> = Object.freeze({})
const EMPTY_PATCH: Readonly<Record<string, Twin2dPrimPatch>> = Object.freeze({})

function recordOf(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

/**
 * 多遍描边，一遍都不剩时补 `fallback`。
 * ⚠ 兜底不只在「没配描边」时生效：`normalizeStrokes` 会丢掉缺 id 的那几遍（id 是
 * `v-for` 的 key，不许按下标补），所以一份只写了 width 的描边也会落到这里的缺省上。
 * 少了这道兜底，线宽会落到 SVG 默认的 1px，引脚与导线粗细对不上（§4.4）。
 * @param raw 原始描边数组
 * @param fallback 一遍都不剩时补的那一遍
 */
function strokesOr(
  raw: unknown,
  fallback: Twin2dStrokePass,
): Twin2dStrokePass[] {
  const passes = normalizeStrokes(raw)
  return passes.length === 0 ? [fallback] : passes
}

/** 流动虚线段长：非正数一律丢弃（段长求和为 0 会让流动动画停在原处）。 */
function positiveDash(raw: unknown): number[] {
  const dash: number[] = []
  for (const item of toArray(raw)) {
    const length = toFiniteNumber(item)
    if (length !== null && length > 0) dash.push(length)
  }
  return dash
}

function collect<T>(
  raw: unknown,
  one: (item: unknown) => T | null,
  keyOf: (item: T) => string,
): T[] {
  const kept: T[] = []
  for (const item of toArray(raw)) {
    const normalized = one(item)
    if (normalized !== null) kept.push(normalized)
  }
  return uniqueBy(kept, keyOf)
}

function normalizeEnumMap(raw: unknown): Readonly<Record<string, string>> {
  if (!isRecord(raw)) return EMPTY_ENUM_MAP
  // ⚠ 用 Map 收：直接往对象字面量上赋 `__proto__` 这类键会改到原型而不是加一个属性
  const kept = new Map<string, string>()
  for (const [rawKey, rawValue] of Object.entries(raw)) {
    const key = trimmedString(rawKey)
    const text = trimmedString(rawValue)
    if (key === '' || text === '' || kept.has(key)) continue
    kept.set(key, text)
  }
  return Object.freeze(Object.fromEntries(kept))
}

/**
 * 一个槽位；没有 key 的一条丢弃（返回 null）。
 * ⚠ `kind: 'derived'` 但算式不合法（含超深）时**降级成 `live`**：留着一个
 * `derived` 而 `expr` 为 null 的槽，求值层永远算不出值，绑点面板又因为它是派生槽
 * 而不给它一行，于是这一格永远显示占位符且哪儿都不报错（§9.5）。
 * @param raw 原始槽位
 */
export function normalizeSlot(raw: unknown): Twin2dSlot | null {
  if (!isRecord(raw)) return null
  const key = trimmedString(raw.key)
  if (key === '') return null
  const kind = oneOf(raw.kind, TWIN_2D_SLOT_KINDS, 'live')
  const expr = kind === 'derived' ? normalizeExpr(raw.expr, 0) : null
  const precision = toFiniteNumber(raw.precision)
  const placeholder = trimmedString(raw.placeholder)
  return {
    key,
    label: trimmedString(raw.label),
    kind: expr === null ? 'live' : 'derived',
    dataType: oneOf(raw.dataType, BINDING_DATA_TYPES, 'number'),
    unit: trimmedString(raw.unit),
    precision:
      precision === null
        ? null
        : clamp(Math.round(precision), 0, MAX_SLOT_PRECISION),
    enumMap: normalizeEnumMap(raw.enumMap),
    placeholder: placeholder === '' ? TWIN_2D_DEFAULT_PLACEHOLDER : placeholder,
    primary: boolOr(raw.primary, false),
    expr,
  }
}

/**
 * 一批槽位：丢弃无 key 的条目，同 key 只留最先一条，保持文档序。
 * ⚠ 文档序就是 `nodeValues` 的行序（§14.2），所以派生绑定行必须喂这里的输出。
 * @param raw 原始槽位数组
 */
export function normalizeSlots(raw: unknown): Twin2dSlot[] {
  return collect(raw, normalizeSlot, (slot) => slot.key)
}

function wrapUnit(value: unknown): number {
  const parsed = toFiniteNumber(value)
  if (parsed === null) return 0
  // ⚠ 周长参数是环形的（1 与 0 是同一点），越界要 wrap 不能 clamp：夹取会把一圈
  //   以外的引脚全堆到起点那一处，而堆叠在图上看着像「少画了几个引脚」
  return ((parsed % 1) + 1) % 1
}

function normalizePortAt(raw: unknown): Twin2dPortAt {
  const source = recordOf(raw)
  const kind = oneOf(source.kind, TWIN_2D_PORT_AT_KINDS, 'perim')
  if (kind === 'xy') {
    return { kind: 'xy', x: unitOr(source.x, 0.5), y: unitOr(source.y, 0.5) }
  }
  return { kind: 'perim', t: wrapUnit(source.t) }
}

function normalizePinMarker(raw: unknown): Twin2dPinMarker | null {
  if (!isRecord(raw)) return null
  const shape = normalizeShape(raw.shape)
  if (shape === null) return null
  return {
    shape,
    strokes: strokesOr(raw.strokes, DEFAULT_PIN_STROKE),
    fill: normalizePaint(raw.fill),
    length: posDim(raw.length, DEFAULT_PIN_LENGTH),
  }
}

/**
 * 一个端口；没有 id 的一条丢弃（返回 null）——连线按 id 挂，无名引脚挂不上。
 * ⚠ `side` 认不出时回 `'auto'` 而不是随手钉一条边：`'auto'` 会在几何层按落点解析
 * 成四档 Side，钉错边的表现是这一根线从错误的方向出去、其余线全对（§4.4）。
 * @param raw 原始端口
 */
export function normalizePort(raw: unknown): Twin2dPort | null {
  if (!isRecord(raw)) return null
  const id = idOf(raw.id)
  if (id === '') return null
  return {
    id,
    name: trimmedString(raw.name),
    at: normalizePortAt(raw.at),
    dir: oneOf(raw.dir, TWIN_2D_PORT_DIRS, 'both'),
    side: oneOf(raw.side, TWIN_2D_PORT_SIDES, 'auto'),
    showName: boolOr(raw.showName, false),
    marker: normalizePinMarker(raw.marker),
  }
}

/**
 * 一批端口：丢弃无 id 的条目，同 id 只留最先一条。
 * @param raw 原始端口数组
 */
export function normalizePorts(raw: unknown): Twin2dPort[] {
  return collect(raw, normalizePort, (port) => port.id)
}

function normalizeVariantPatch(
  raw: unknown,
): Readonly<Record<string, Twin2dPrimPatch>> {
  if (!isRecord(raw)) return EMPTY_PATCH
  const kept = new Map<string, Twin2dPrimPatch>()
  for (const [rawKey, rawValue] of Object.entries(raw)) {
    const primId = idOf(rawKey)
    if (primId === '' || kept.has(primId) || !isRecord(rawValue)) continue
    kept.set(primId, normalizePrimPatch(rawValue))
  }
  return Object.freeze(Object.fromEntries(kept))
}

/**
 * 节点根上的覆盖：只写显式给出的键。
 * ⚠ 空数组的阴影**不写这个键**——浅覆盖里「清空阴影」与「不覆盖阴影」分不开，
 * 取后者：hover 变体想去掉外发光时给一条透明阴影，别给空数组。
 * @param raw 原始 rootPatch
 */
export function normalizeRootPatch(raw: unknown): Twin2dRootPatch {
  if (!isRecord(raw)) return {}
  const patch: Twin2dRootPatch = {}
  const lift = toFiniteNumber(raw.lift)
  if (lift !== null) patch.lift = lift
  // ⚠ 0 与负数一律不写这个键：等比缩放到 0 会让整个节点塌成一个点，而没有一处会报错
  const scale = toFiniteNumber(raw.scale)
  if (scale !== null && scale > 0) patch.scale = scale
  const shadows = normalizeShadows(raw.shadows)
  if (shadows.length > 0) patch.shadows = shadows
  const borderColor = trimmedString(raw.borderColor)
  if (borderColor !== '') patch.borderColor = borderColor
  const z = toFiniteNumber(raw.z)
  if (z !== null) patch.z = z
  const accent = trimmedString(raw.accent)
  if (accent !== '') patch.accent = accent
  return patch
}

/**
 * 一条变体；没有 id 或条件不合法的一条丢弃（返回 null）。
 * @param raw 原始变体
 */
export function normalizeVariant(raw: unknown): Twin2dVariant | null {
  if (!isRecord(raw)) return null
  const id = idOf(raw.id)
  if (id === '') return null
  const when = normalizeCondition(raw.when)
  if (when === null) return null
  return {
    id,
    when,
    patch: normalizeVariantPatch(raw.patch),
    rootPatch: normalizeRootPatch(raw.rootPatch),
  }
}

/**
 * 一批变体：丢弃脏条目，同 id 只留最先一条。
 * ⚠ **保持文档序**：变体按文档序求值、后者覆盖前者，重排就是改渲染结果（§4.5）。
 * @param raw 原始变体数组
 */
export function normalizeVariants(raw: unknown): Twin2dVariant[] {
  return collect(raw, normalizeVariant, (variant) => variant.id)
}

function roundedDim(value: unknown, fallback: number): number {
  return Math.max(1, Math.round(posDim(value, fallback)))
}

/**
 * 一个节点样式；没有 id 的一条丢弃（返回 null）。
 * ⚠ `defaultStatus` 认不出时回 `'online'`——参考项目里「未声明状态」画的就是
 * `--state-success`（§7 #55）；装饰类样式要的是显式的 `'hidden'`。
 * ⚠ `size` 是**整数**设计像素且不许落到 0：`posDim` 之后还要 `Math.round`，而
 * 0.4 圆下去就是 0，一个宽 0 的节点在画布上什么都不画且哪儿都不报错。
 * @param raw 原始节点样式
 */
export function normalizeNodeStyle(raw: unknown): Twin2dNodeStyle | null {
  if (!isRecord(raw)) return null
  const id = idOf(raw.id)
  if (id === '') return null
  const size = recordOf(raw.size)
  return {
    id,
    name: trimmedString(raw.name),
    category: trimmedString(raw.category),
    accent: trimmedString(raw.accent),
    defaultStatus: oneOf(raw.defaultStatus, TWIN_2D_DEFAULT_STATUSES, 'online'),
    size: {
      w: roundedDim(size.w, DEFAULT_STYLE_WIDTH),
      h: roundedDim(size.h, DEFAULT_STYLE_HEIGHT),
    },
    prims: normalizePrims(raw.prims, 0),
    ports: normalizePorts(raw.ports),
    slots: normalizeSlots(raw.slots),
    variants: normalizeVariants(raw.variants),
  }
}

/**
 * 一批节点样式：丢弃无 id 的条目，同 id 只留最先一条。
 * ⚠ 同 id 时**先出现的赢**，而文档里的样式又整体优先于预置库（§13.4）：两条规矩
 * 合起来才是「用户改过的那一份说了算」。
 * @param raw 原始节点样式数组
 */
export function normalizeNodeStyles(raw: unknown): Twin2dNodeStyle[] {
  return collect(raw, normalizeNodeStyle, (style) => style.id)
}

function normalizeEdgeMarker(raw: unknown): Twin2dEdgeMarker {
  if (!isRecord(raw)) return { kind: 'none' }
  if (oneOf(raw.kind, TWIN_2D_EDGE_MARKER_KINDS, 'none') !== 'arrow') {
    return { kind: 'none' }
  }
  return {
    kind: 'arrow',
    size: posDim(raw.size, DEFAULT_ARROW_SIZE),
    spread: clamp(
      toFiniteNumber(raw.spread) ?? DEFAULT_ARROW_SPREAD,
      MIN_ARROW_SPREAD,
      MAX_ARROW_SPREAD,
    ),
    filled: boolOr(raw.filled, true),
    opacity: unitOr(raw.opacity, DEFAULT_ARROW_OPACITY),
  }
}

function normalizeEdgeFlow(raw: unknown): Twin2dEdgeFlow {
  const source = recordOf(raw)
  const dash = positiveDash(source.dash)
  return {
    enabled: boolOr(source.enabled, false),
    // ⚠ 一段都不剩就补缺省：dashoffset 的终点由 dash 求和算出，和为 0 时动画每一帧
    //   都停在原处，看起来像「流动开关坏了」（§7.9 #67）
    dash: dash.length === 0 ? DEFAULT_FLOW_DASH : dash,
    durationMs: posDim(source.durationMs, DEFAULT_FLOW_DURATION_MS),
  }
}

function normalizeEdgeInactive(raw: unknown): Twin2dEdgeInactive {
  const source = recordOf(raw)
  return {
    opacity: unitOr(source.opacity, DEFAULT_INACTIVE_OPACITY),
    dashOff: boolOr(source.dashOff, true),
    // 空串 = 沿用边色
    color: trimmedString(source.color),
  }
}

function normalizeEdgeLabel(raw: unknown): Twin2dEdgeLabel {
  const source = recordOf(raw)
  const box = source.box
  if (!isRecord(box)) return { font: normalizeFont(source.font), box: null }
  return {
    font: normalizeFont(source.font),
    box: {
      fill: trimmedString(box.fill),
      border: normalizeBorder(box.border),
      radius: normalizeRadius(box.radius),
      pad: normalizePad(box.pad),
    },
  }
}

/**
 * 一个连线样式；没有 id 的一条丢弃（返回 null）。
 * ⚠ `route` 认不出时回 `'auto'` = 跟随几何层的缺省（正交），不就地钉死一档。
 * @param raw 原始连线样式
 */
export function normalizeEdgeStyle(raw: unknown): Twin2dEdgeStyle | null {
  if (!isRecord(raw)) return null
  const id = idOf(raw.id)
  if (id === '') return null
  return {
    id,
    name: trimmedString(raw.name),
    accent: trimmedString(raw.accent),
    strokes: strokesOr(raw.strokes, DEFAULT_EDGE_STROKE),
    route: oneOf(raw.route, TWIN_2D_EDGE_ROUTES, 'auto'),
    cornerRadius: Math.max(
      0,
      finiteOr(raw.cornerRadius, TWIN_2D_DEFAULT_CORNER_RADIUS),
    ),
    startMarker: normalizeEdgeMarker(raw.startMarker),
    endMarker: normalizeEdgeMarker(raw.endMarker),
    flow: normalizeEdgeFlow(raw.flow),
    inactive: normalizeEdgeInactive(raw.inactive),
    label: normalizeEdgeLabel(raw.label),
  }
}

/**
 * 一批连线样式：丢弃无 id 的条目，同 id 只留最先一条。
 * @param raw 原始连线样式数组
 */
export function normalizeEdgeStyles(raw: unknown): Twin2dEdgeStyle[] {
  return collect(raw, normalizeEdgeStyle, (style) => style.id)
}
