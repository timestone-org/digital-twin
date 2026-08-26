/**
 * @fileoverview 连线实例的归一化：端点、拐点、走线档，以及指向不存在节点的整条丢弃。
 * 口径见 docs/MODULE_TWIN_2D_DESIGN.md §4.6（端点解析优先级）与 §8（labelAt 的弧长定义）。
 */
import { TWIN_2D_EDGE_ROUTES } from './kinds'
import {
  clamp,
  finiteOr,
  idOf,
  isRecord,
  oneOf,
  toArray,
  toFiniteNumber,
  trimmedString,
  uniqueBy,
} from './sanitize'
import type { Twin2dEdge, Twin2dEndpoint, Twin2dWaypoint } from './types'

/** 标签落在折线中点 */
const DEFAULT_LABEL_AT = 0.5

/**
 * 归一化一个连线端点；节点 id 缺失或指不到已有节点时返回 null。
 * `t` 是绕节点盒的周长参数，夹到 [0,1]（几何层的 `wrap01` 把 1 与 0 视作同一点）。
 * `portId` 允许为空串——空 = 不钉引脚，由几何层朝对方中心自动选边（§4.6 的三级优先级）。
 * @param raw 原始端点
 * @param nodeIds 归一化后仍然存在的节点 id 集合
 */
export function normalizeEndpoint(
  raw: unknown,
  nodeIds: ReadonlySet<string>,
): Twin2dEndpoint | null {
  if (!isRecord(raw)) return null
  const nodeId = idOf(raw.nodeId)
  if (nodeId === '' || !nodeIds.has(nodeId)) return null
  const t = toFiniteNumber(raw.t)
  return {
    nodeId,
    portId: idOf(raw.portId),
    t: t === null ? null : clamp(t, 0, 1),
  }
}

/**
 * 归一化拐点列表：坐标取不到数的点**逐个**丢弃，整条连线照旧。
 * ⚠ 与端点相反——拐点只是中途的形状调整，丢一个拐点线还在原来两端之间；
 * 而端点丢了这条线就没有归宿（见 `normalizeEdge`）。
 * @param raw 原始拐点数组
 */
export function normalizeWaypoints(raw: unknown): Twin2dWaypoint[] {
  const kept: Twin2dWaypoint[] = []
  for (const item of toArray(raw)) {
    if (!isRecord(item)) continue
    const x = toFiniteNumber(item.x)
    const y = toFiniteNumber(item.y)
    if (x === null || y === null) continue
    kept.push({ x, y })
  }
  return kept
}

/**
 * 归一化一条连线；id 缺失或任一端悬空时返回 null。
 * ⚠ **悬空端点丢整条，不画一条到 (0,0) 的线。** 一条落在画布左上角的斜线看起来像
 * 「拐点算错了」而不像「那个节点被删了」，用户会去调拐点；而它同时会让 `edgeValues`
 * 的行数与文档序都对不上（§14.2 按文档序钉行）。丢掉的整条由诊断面的 `dropped-edge`
 * 按**原始**下标报出来，它点得出是哪一端的哪个节点查不到。
 * @param raw 原始连线
 * @param nodeIds 归一化后仍然存在的节点 id 集合
 */
export function normalizeEdge(
  raw: unknown,
  nodeIds: ReadonlySet<string>,
): Twin2dEdge | null {
  if (!isRecord(raw)) return null
  const id = idOf(raw.id)
  if (id === '') return null
  const from = normalizeEndpoint(raw.from, nodeIds)
  const to = normalizeEndpoint(raw.to, nodeIds)
  if (from === null || to === null) return null
  return {
    id,
    styleId: idOf(raw.styleId),
    from,
    to,
    // 认不出的走线档回 'auto' = 跟随样式，而不是就地钉死一档（§7.9 #63）
    route: oneOf(raw.route, TWIN_2D_EDGE_ROUTES, 'auto'),
    waypoints: normalizeWaypoints(raw.waypoints),
    accent: trimmedString(raw.accent),
    label: trimmedString(raw.label),
    labelAt: clamp(finiteOr(raw.labelAt, DEFAULT_LABEL_AT), 0, 1),
  }
}

/**
 * 归一化整份连线列表：丢弃脏条目与悬空连线，同 id 只留最先出现的一条。
 * @param raw 原始连线数组
 * @param nodeIds 归一化后仍然存在的节点 id 集合
 */
export function normalizeEdges(
  raw: unknown,
  nodeIds: ReadonlySet<string>,
): Twin2dEdge[] {
  const kept: Twin2dEdge[] = []
  for (const item of toArray(raw)) {
    const edge = normalizeEdge(item, nodeIds)
    if (edge !== null) kept.push(edge)
  }
  return uniqueBy(kept, (edge) => edge.id)
}
