/**
 * @fileoverview 画布剪贴板：把一批节点连同它们内部的边存起来，供跨流水线粘贴。
 *
 * ⚠ 走 `localStorage` 而不是页面内的一个 ref：复制一段子图去另一条流水线里
 * 复用，正是这颗按钮最主要的用处，而换页面就意味着组件已经卸载了。
 * ⚠ 读回来的东西一律当**不可信**逐项验形：存进去的是上一个版本写的、或者被人
 * 手改过的，形状对不上时静默粘出半个节点比什么都不粘更糟。
 */
import type { ModelingGraphEdge, ModelingGraphNode } from '@dt/contracts'

/** 版本号进键名：形状换代时旧载荷直接读不到，不必写迁移。 */
const STORAGE_KEY = 'dt.modeling.clipboard.v1'

/** 一份剪贴板载荷。 */
export interface GraphClip {
  nodes: ModelingGraphNode[]
  edges: ModelingGraphEdge[]
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/** 读一个节点。id 或算子码缺失就当这一条不存在。 */
function nodeOf(raw: unknown): ModelingGraphNode | null {
  const item = asRecord(raw)
  const id = asText(item['id'])
  const operator = asText(item['operator'])
  if (id === '' || operator === '') return null
  const at = asRecord(item['position'])
  return {
    id,
    operator,
    alias: asText(item['alias']),
    config: asRecord(item['config']),
    position: { left: asNumber(at['left']), top: asNumber(at['top']) },
  }
}

/** 读一条边。四个端点缺一不可。 */
function edgeOf(raw: unknown): ModelingGraphEdge | null {
  const item = asRecord(raw)
  const fields = {
    id: asText(item['id']),
    from_node: asText(item['from_node']),
    from_port: asText(item['from_port']),
    to_node: asText(item['to_node']),
    to_port: asText(item['to_port']),
  }
  return Object.values(fields).some((value) => value === '') ? null : fields
}

/** 由一份选中集造一份载荷；一个节点都没选中时给 null。 */
export function clipOf(
  nodes: readonly ModelingGraphNode[],
  edges: readonly ModelingGraphEdge[],
  nodeIds: readonly string[],
): GraphClip | null {
  const wanted = new Set(nodeIds)
  const picked = nodes.filter((node) => wanted.has(node.id))
  if (picked.length === 0) return null
  return {
    nodes: picked.map((node) => structuredClone(node)),
    edges: edges.filter(
      (edge) => wanted.has(edge.from_node) && wanted.has(edge.to_node),
    ),
  }
}

/** 写进剪贴板。浏览器不给写（隐私模式、配额满）时静默作罢。 */
export function writeClip(clip: GraphClip): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(clip))
  } catch {
    // 存不进去只是粘不出来，不该把一次复制变成一条报错
  }
}

/** 读回剪贴板。没有、读不了、或形状不对时一律给 null。 */
export function readClip(): GraphClip | null {
  let raw: string | null = null
  try {
    raw = window.localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
  if (raw === null) return null
  let parsed: unknown = null
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  const bag = asRecord(parsed)
  const nodes = (Array.isArray(bag['nodes']) ? bag['nodes'] : [])
    .map(nodeOf)
    .filter((node): node is ModelingGraphNode => node !== null)
  if (nodes.length === 0) return null
  const edges = (Array.isArray(bag['edges']) ? bag['edges'] : [])
    .map(edgeOf)
    .filter((edge): edge is ModelingGraphEdge => edge !== null)
  return { nodes, edges }
}
