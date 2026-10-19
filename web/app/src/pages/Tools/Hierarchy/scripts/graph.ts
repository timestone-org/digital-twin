/** @fileoverview 层级图导入边界校验与逻辑层级。 */
import type { GraphDocument, GraphEdge, GraphNode, Issue } from './types'
export class DomainError extends Error {
  code: string
  issues: Issue[]
  constructor(message: string, code = 'VALIDATION', issues: Issue[] = []) {
    super(message)
    this.code = code
    this.issues = issues
  }
}
export function object(
  value: unknown,
  label = '配置',
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new DomainError(`${label}格式错误`)
  // ⚠ 对象边界已排除 null 与数组，所有字段随后逐个校验。
  return value as Record<string, unknown>
}
export function text(
  value: unknown,
  label: string,
  maximum: number,
  required = true,
): string {
  if (typeof value !== 'string' || value.length > maximum)
    throw new DomainError(`${label}必须是长度不超过 ${maximum} 的文字`)
  if (required && !value.trim()) throw new DomainError(`${label}不能为空`)
  return value.trim()
}
function number(
  value: unknown,
  label: string,
  min = -100000,
  max = 100000,
): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  )
    throw new DomainError(`${label}超出允许范围`)
  return value
}
export function validate(original: unknown): GraphDocument {
  const d = object(original)
  if (d.schemaVersion !== 1)
    throw new DomainError('配置版本不支持，请导入层绘 v1 配置文件')
  if (d.templateId !== 'case-v1')
    throw new DomainError('图纸必须使用案例标准模板 case-v1')
  if (!Array.isArray(d.nodes) || d.nodes.length > 300)
    throw new DomainError('每张图最多支持 300 个元素')
  if (!Array.isArray(d.edges) || d.edges.length > 2000)
    throw new DomainError('每张图最多支持 2000 条连接')
  const nodes = parseNodes(d.nodes),
    edges = parseEdges(d.edges, nodes)
  const v = object(d.viewport, '视图')
  const paper =
    d.paper === undefined ? { width: 1516 } : object(d.paper, '图纸')
  const result: GraphDocument = {
    schemaVersion: 1,
    templateId: 'case-v1',
    title: text(d.title, '项目名称', 80),
    nodes,
    edges,
    paper: {
      width: Math.round(
        number(paper.width, '图纸宽度（360～12000 px）', 360, 12000),
      ),
    },
    viewport: {
      x: number(v.x, '视图坐标'),
      y: number(v.y, '视图坐标'),
      zoom: number(v.zoom, '缩放比例', 0.05, 4),
    },
  }
  ranks(result)
  return result
}
export function ranks(document: GraphDocument): Map<string, number> {
  const byId = new Map(document.nodes.map((n) => [n.id, n]))
  const degrees = new Map(document.nodes.map((n) => [n.id, 0])),
    children = new Map(document.nodes.map((n) => [n.id, [] as string[]]))
  const result = new Map(document.nodes.map((n) => [n.id, 0]))
  for (const edge of document.edges) {
    degrees.set(edge.target, required(degrees.get(edge.target)) + 1)
    required(children.get(edge.source)).push(edge.target)
  }
  const queue = [...degrees].filter(([, degree]) => !degree).map(([id]) => id)
  let count = 0
  while (queue.length) {
    const id = required(queue.shift())
    count++
    for (const child of required(children.get(id))) {
      const step = required(byId.get(child)).kind === 'junction' ? 0 : 1
      result.set(
        child,
        Math.max(required(result.get(child)), required(result.get(id)) + step),
      )
      degrees.set(child, required(degrees.get(child)) - 1)
      if (!degrees.get(child)) queue.push(child)
    }
  }
  if (count !== document.nodes.length)
    throw new DomainError(
      '连接形成循环，层级图只允许从上游到下游的关系',
      'CYCLE',
    )
  return result
}

import { required } from './required'

function parseNodes(values: unknown[]): GraphNode[] {
  const ids = new Set<string>(),
    codes = new Set<string>()
  const nodes = values.map((value): GraphNode => {
    const n = object(value, '节点'),
      p = object(n.position, '节点坐标')
    const id = text(n.id, '节点标识', 100),
      code = text(n.code, '节点编号', 40)
    if (ids.has(id) || codes.has(code))
      throw new DomainError(`节点标识或编号重复：${code}`)
    ids.add(id)
    codes.add(code)
    if (n.kind !== 'meter' && n.kind !== 'junction')
      throw new DomainError('不支持的节点类型')
    return {
      id,
      code,
      kind: n.kind,
      name: text(n.name, '节点名称', 100),
      parameter: text(n.parameter, '圆内下栏', 40, false),
      order: number(n.order ?? 0, '排列顺序', 0, 99999),
      position: { x: number(p.x, '编辑坐标'), y: number(p.y, '编辑坐标') },
    }
  })

  return nodes
}
function parseEdges(values: unknown[], nodes: GraphNode[]): GraphEdge[] {
  const byId = new Map(nodes.map((n) => [n.id, n])),
    pairs = new Set<string>(),
    edgeIds = new Set<string>()
  const edges = values.map((value): GraphEdge => {
    const e = object(value, '连接'),
      id = text(e.id, '连接标识', 100)
    const source = text(e.source, '上游节点标识', 100),
      target = text(e.target, '下游节点标识', 100)
    if (!byId.has(source) || !byId.has(target))
      throw new DomainError('连接引用了不存在的节点')
    if (source === target) throw new DomainError('节点不能连接到自身')
    const pair = JSON.stringify([source, target])
    if (pairs.has(pair) || edgeIds.has(id))
      throw new DomainError('存在重复连接')
    if (
      required(byId.get(source)).kind === 'junction' &&
      required(byId.get(target)).kind === 'junction'
    )
      throw new DomainError(
        '同一汇流关系请使用一个汇流点，汇流点之间不直接连接',
      )
    pairs.add(pair)
    edgeIds.add(id)
    return { id, source, target }
  })

  return edges
}
