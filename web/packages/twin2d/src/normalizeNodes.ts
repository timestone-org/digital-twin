/**
 * @fileoverview 节点实例的归一化：一个节点的位姿与外观、子类 tags、按图元 id 的覆盖
 * 补丁与追加图元。口径见 docs/MODULE_TWIN_2D_DESIGN.md §4.6、§6.3、§10。
 */
import { TWIN_2D_MAX_TAG_LENGTH } from './constants'
import {
  TWIN_2D_BADGE_SHAPES,
  TWIN_2D_LABEL_POSITIONS,
  TWIN_2D_NODE_ROTATIONS,
  TWIN_2D_STATUSES,
} from './kinds'
import { normalizePrimPatch, normalizePrims } from './normalizePrims'
import { normalizePorts, normalizeSlots } from './normalizeStyles'
import {
  boolOr,
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
import type { Twin2dStatus } from './kinds'
import type { Twin2dPrimPatch } from './typesPrim'
import type { Twin2dNode } from './types'

/** 静态 status 的取值域：四档加「不指定」。 */
const NODE_STATUSES: readonly (Twin2dStatus | '')[] = Object.freeze([
  ...TWIN_2D_STATUSES,
  '',
])

/** 空标签表 */
const EMPTY_TAGS: Readonly<Record<string, string>> = Object.freeze({})
/** 空补丁表 */
const EMPTY_PATCH: Readonly<Record<string, Twin2dPrimPatch>> = Object.freeze({})

/**
 * 子类等自由维度的标签表：键值都 trim 并截到长度上限，空键丢弃。
 * ⚠ 只做 trim 与截断，不做白名单——做了白名单就等于把子类重新钉死成枚举，
 * 变体的 `tag` 一档就白加了（§6.3）。
 * ⚠ 用 Map 收后再 `Object.fromEntries`：直接往对象字面量上赋 `__proto__` 这类键
 * 会改到原型而不是加一个属性，而它零报错。
 * @param raw 原始 tags
 */
export function normalizeTags(raw: unknown): Readonly<Record<string, string>> {
  if (!isRecord(raw)) return EMPTY_TAGS
  const kept = new Map<string, string>()
  for (const [rawKey, rawValue] of Object.entries(raw)) {
    const key = trimmedString(rawKey).slice(0, TWIN_2D_MAX_TAG_LENGTH)
    if (key === '' || kept.has(key)) continue
    kept.set(key, trimmedString(rawValue).slice(0, TWIN_2D_MAX_TAG_LENGTH))
  }
  return Object.freeze(Object.fromEntries(kept))
}

/**
 * 节点级覆盖补丁：键是被覆盖的图元 id，值是一份浅补丁。
 * ⚠ 空键、重复键与非对象的值都整条丢弃——留着它会指向一个寻不到的图元，
 * 而寻不到在渲染层是「什么都没发生」，零报错。
 * @param raw 原始 patch
 */
export function normalizeNodePatch(
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
 * 一个节点实例；没有 id 的一条丢弃（返回 null）。
 * ⚠ `x`/`y` 是左上角的设计坐标，**可以为负**：图往左上扩是常事，夹到 0 会把整片
 * 节点悄悄压到画布边上。
 * ⚠ `w`/`h` 走 `posDim` 且缺省是 **0**，0 的语义是「跟样式的 `size` 走」，由渲染层
 * 解析成 `w > 0 ? w : style.size.w`。这里拿不到样式，所以只能留一个哨兵值；
 * `posDim` 本就把 0 与负数一律判为无值，故 0 永远不会是一个用户配出来的真尺寸。
 * ⚠ `rotate` 非法一律回 0，**不取最近的一档**：把手误输入的 45 圆成 0 或 90，
 * 用户会以为自己配对了，而图上是另一个朝向。
 * ⚠ `status` 只是静态兜底，实时 `nodeStatus` 行覆盖它（覆盖逻辑在 Component.vue，
 * 见 §10.1）；`''` = 交给样式的 `defaultStatus`。
 * @param raw 原始节点
 */
export function normalizeNode(raw: unknown): Twin2dNode | null {
  if (!isRecord(raw)) return null
  const id = idOf(raw.id)
  if (id === '') return null
  return {
    id,
    styleId: idOf(raw.styleId),
    x: finiteOr(raw.x, 0),
    y: finiteOr(raw.y, 0),
    w: posDim(raw.w, 0),
    h: posDim(raw.h, 0),
    rotate: oneOf(toFiniteNumber(raw.rotate), TWIN_2D_NODE_ROTATIONS, 0),
    flipX: boolOr(raw.flipX, false),
    flipY: boolOr(raw.flipY, false),
    label: trimmedString(raw.label),
    labelPos: oneOf(raw.labelPos, TWIN_2D_LABEL_POSITIONS, 'bottom'),
    status: oneOf(trimmedString(raw.status), NODE_STATUSES, ''),
    accent: trimmedString(raw.accent),
    badge: trimmedString(raw.badge),
    badgeColor: trimmedString(raw.badgeColor),
    badgeShape: oneOf(raw.badgeShape, TWIN_2D_BADGE_SHAPES, 'round'),
    tags: normalizeTags(raw.tags),
    slots: normalizeSlots(raw.slots),
    layers: normalizePrims(raw.layers, 0),
    patch: normalizeNodePatch(raw.patch),
    ports: normalizePorts(raw.ports),
  }
}

/**
 * 一批节点：丢弃无 id 的条目，按 id 去重（后来者丢弃），**保持文档序**。
 * ⚠ 文档序就是绑定行号：`nodeStatus[i]` 钉的是这里输出的第 i 个节点，所以派生绑定行
 * 与缝合读值必须喂同一份输出，喂原始配置会因为脏条目被丢弃而整体错位一格（§14.2）。
 * @param raw 原始节点数组
 */
export function normalizeNodes(raw: unknown): Twin2dNode[] {
  const nodes: Twin2dNode[] = []
  for (const item of toArray(raw)) {
    const node = normalizeNode(item)
    if (node !== null) nodes.push(node)
  }
  return uniqueBy(nodes, (node) => node.id)
}
