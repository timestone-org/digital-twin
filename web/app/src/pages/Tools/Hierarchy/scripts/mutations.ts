/** @fileoverview 层级图的纯文档编辑操作。 */
import { validate } from './graph'
import type { GraphDocument, GraphNode, NodeKind } from './types'

export function clone(document: GraphDocument): GraphDocument {
  return structuredClone(document)
}
export function blank(title: string): GraphDocument {
  return {
    schemaVersion: 1,
    templateId: 'case-v1',
    title,
    paper: { width: 1516 },
    nodes: [],
    edges: [],
    viewport: { x: 50, y: 40, zoom: 1 },
  }
}
export function insertNode(
  document: GraphDocument,
  kind: NodeKind,
  position: GraphNode['position'],
  id: string,
): GraphDocument {
  const result = clone(document)
  const prefix = kind === 'meter' ? 'N-' : 'J-'
  let index = 1
  while (
    result.nodes.some(
      (node) => node.code === prefix + String(index).padStart(3, '0'),
    )
  )
    index++
  let slot = 0
  const location = { ...position }
  while (
    result.nodes.some(
      (node) =>
        Math.abs(node.position.x - location.x) < 220 &&
        Math.abs(node.position.y - location.y) < 160,
    )
  ) {
    slot++
    location.x = position.x + (slot % 3) * 240
    location.y = position.y + Math.floor(slot / 3) * 180
  }
  result.nodes.push({
    id,
    kind,
    code: prefix + String(index).padStart(3, '0'),
    name: kind === 'meter' ? '新计量节点' : '新汇流点',
    parameter: kind === 'meter' ? '1.0级' : '',
    order: Math.max(0, ...result.nodes.map((node) => node.order)) + 1,
    position: location,
  })
  return validate(result)
}
export function connectNodes(
  document: GraphDocument,
  source: string,
  target: string,
  id: string,
): GraphDocument {
  return validate({
    ...clone(document),
    edges: [...document.edges, { id, source, target }],
  })
}
export function removeSelection(
  document: GraphDocument,
  ids: readonly string[],
  edgeId: string,
): GraphDocument {
  const selected = new Set(ids)
  return {
    ...clone(document),
    nodes: document.nodes.filter((node) => !selected.has(node.id)),
    edges: document.edges.filter(
      (edge) =>
        edge.id !== edgeId &&
        !selected.has(edge.source) &&
        !selected.has(edge.target),
    ),
  }
}
export function moveNodes(
  document: GraphDocument,
  positions: readonly Pick<GraphNode, 'id' | 'position'>[],
): GraphDocument {
  const byId = new Map(positions.map((node) => [node.id, node.position]))
  return validate({
    ...clone(document),
    nodes: document.nodes.map((node) => ({
      ...node,
      position: byId.get(node.id) ?? node.position,
    })),
  })
}

export function signature(document: GraphDocument | null): string {
  if (!document) return ''
  return JSON.stringify([
    document.schemaVersion,
    document.templateId,
    document.title,
    document.paper.width,
    [document.viewport.x, document.viewport.y, document.viewport.zoom],
    document.nodes.map((node) => [
      node.id,
      node.kind,
      node.code,
      node.name,
      node.parameter,
      node.order,
      node.position.x,
      node.position.y,
    ]),
    document.edges.map((edge) => [edge.id, edge.source, edge.target]),
  ])
}

export function drawingSignature(document: GraphDocument | null): string {
  if (!document) return ''
  return JSON.stringify([
    document.title,
    document.paper.width,
    document.nodes.map((node) => [
      node.id,
      node.kind,
      node.code,
      node.name,
      node.parameter,
      node.order,
    ]),
    document.edges.map((edge) => [edge.id, edge.source, edge.target]),
  ])
}
