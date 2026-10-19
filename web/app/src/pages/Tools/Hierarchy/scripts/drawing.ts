/** @fileoverview 固定计量标准图的安全 SVG 生成。 */
import {
  layoutDiagram,
  type Group,
  type Point,
  type Position,
  type Segment,
} from './diagramLayout'
import { metricsFor, preflight } from './drawingText'
import { DomainError, ranks, validate } from './graph'
import type { Drawing, GraphDocument, GraphNode } from './types'
export { labelLines, units } from './drawingText'
export const TEMPLATE = Object.freeze({
  id: 'case-v1',
  version: 1,
  circleDiameter: 90,
  fontSize: 14,
  lineWidth: 1,
  paperWidth: 1516,
})
const escaped = (value: string) =>
  value.replace(/[&<>"']/g, (c) =>
    required(
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[
        c
      ],
    ),
  )
const fmt = (value: number) => Number(value.toFixed(3)).toString()
function groupsFor(document: GraphDocument): Group[] {
  const byId = new Map(document.nodes.map((n) => [n.id, n])),
    groups: Group[] = []
  for (const node of document.nodes) {
    const targets = document.edges
      .filter((e) => e.source === node.id)
      .map((e) => e.target)
    if (node.kind === 'junction')
      groups.push({
        sources: document.edges
          .filter((e) => e.target === node.id)
          .map((e) => e.source),
        targets,
      })
    else {
      const direct = targets.filter(
        (id) => required(byId.get(id)).kind === 'meter',
      )
      if (direct.length) groups.push({ sources: [node.id], targets: direct })
    }
  }
  return groups
}
export function segmentHits(
  start: Point,
  end: Point,
  box: [number, number, number, number],
): boolean {
  const [x1, y1] = start,
    [x2, y2] = end,
    [left, top, right, bottom] = box
  return x1 === x2
    ? left < x1 &&
        x1 < right &&
        Math.max(y1, y2) > top &&
        Math.min(y1, y2) < bottom
    : top < y1 &&
        y1 < bottom &&
        Math.max(x1, x2) > left &&
        Math.min(x1, x2) < right
}
function crossing(vertical: Segment, horizontal: Segment): Point | null {
  const [x, startY] = vertical.start,
    [, endY] = vertical.end
  const [startX, y] = horizontal.start,
    [endX] = horizontal.end
  if (
    vertical.group === horizontal.group ||
    vertical.start[0] !== vertical.end[0] ||
    horizontal.start[1] !== horizontal.end[1]
  )
    return null
  return Math.min(startX, endX) <= x &&
    x <= Math.max(startX, endX) &&
    Math.min(startY, endY) + 5 < y &&
    y < Math.max(startY, endY) - 5
    ? [x, y]
    : null
}
function crossingMarks(segments: Segment[]): string[] {
  const points = new Map<string, Point>()
  for (const vertical of segments)
    for (const horizontal of segments) {
      const point = crossing(vertical, horizontal)
      if (point) points.set(JSON.stringify(point), point)
    }
  return [...points.values()].map(
    ([x, y]) =>
      `<path d="M${fmt(x)} ${fmt(y - 4)} V${fmt(y + 4)}" stroke="white" stroke-width="5"/><path d="M${fmt(x)} ${fmt(y - 4)} V${fmt(y + 4)}"/>`,
  )
}
function renderSegments(segments: Segment[]): string {
  const seen = new Set<string>(),
    result: string[] = [],
    unique: Segment[] = []
  for (const segment of segments) {
    const { start, end, arrow } = segment,
      identity = JSON.stringify(segment)
    if (seen.has(identity) || (start[0] === end[0] && start[1] === end[1]))
      continue
    seen.add(identity)
    unique.push(segment)
    result.push(
      `<path data-net="${segment.group}" d="M${fmt(start[0])} ${fmt(start[1])} L${fmt(end[0])} ${fmt(end[1])}"${arrow ? ' marker-end="url(#arrow)"' : ''}/>`,
    )
  }
  return [...result, ...crossingMarks(unique)].join('')
}
function renderNode(n: GraphNode, p: Position): string {
  const textY = p.labelTop + (p.labelHeight - (p.lines.length - 1) * 17) / 2 + 5
  const label = p.lines
    .map(
      (line, i) =>
        `<tspan x="${fmt(p.x)}" y="${fmt(textY + i * 17)}">${escaped(line)}</tspan>`,
    )
    .join('')
  return `<g data-node-id="${escaped(n.id)}"><circle cx="${fmt(p.x)}" cy="${fmt(p.y)}" r="45" fill="white" stroke="#111"/><path d="M${fmt(p.x - 45)} ${fmt(p.y)} H${fmt(p.x + 45)} M${fmt(p.x)} ${fmt(p.y + 45)} V${fmt(p.labelTop)}" fill="none" stroke="#111"/><text x="${fmt(p.x)}" y="${fmt(p.y - 5)}">${escaped(n.code)}</text><text x="${fmt(p.x)}" y="${fmt(p.y + 20)}">${escaped(n.parameter)}</text><rect x="${fmt(p.x - p.labelWidth / 2)}" y="${fmt(p.labelTop)}" width="${fmt(p.labelWidth)}" height="${p.labelHeight}" fill="white" stroke="#111"/><text>${label}</text></g>`
}
export function generate(original: unknown): Drawing {
  const document = validate(original),
    depth = ranks(document),
    warnings = preflight(document, depth),
    groups = groupsFor(document)
  const metrics = metricsFor(document, depth)
  const { positions, rows, segments, width } = layoutDiagram(
    document,
    depth,
    groups,
    metrics,
  )
  const height = Math.max(
    360,
    Math.max(...[...positions.values()].map((p) => p.bottom)) + 46,
  )
  checkCollisions(document, positions, segments)
  const shapes = document.nodes
    .filter((n) => n.kind === 'meter')
    .map((n) => renderNode(n, required(positions.get(n.id))))
    .join('')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escaped(document.title)}" font-family="Arial, Microsoft YaHei, PingFang SC, sans-serif" font-size="14" fill="#111" text-anchor="middle"><defs><marker id="arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="8" markerHeight="8" orient="auto"><path d="M1 1 L7 4 L1 7 L3 4 Z" fill="#111"/></marker></defs><rect width="${width}" height="${height}" fill="white"/><g stroke="#111" stroke-width="1" fill="none">${renderSegments(segments)}</g>${shapes}</svg>`
  return {
    svg,
    width,
    height,
    nodeCount: positions.size,
    levelCount: new Set([...positions.values()].map((p) => p.rank)).size,
    rows,
    positions: Object.fromEntries(positions),
    warnings,
  }
}

import { required } from './required'

function checkCollisions(
  document: GraphDocument,
  positions: Map<string, Position>,
  segments: Segment[],
) {
  for (const segment of segments)
    for (const [id, p] of positions) {
      if (
        segmentHits(segment.start, segment.end, [
          p.x - p.labelWidth / 2,
          p.y - 45,
          p.x + p.labelWidth / 2,
          p.bottom,
        ])
      ) {
        throw new DomainError(
          '当前关系的走线与节点冲突，请调整同层顺序或使用汇流点',
          'LAYOUT_CONFLICT',
          [
            {
              nodeId: id,
              message: `连线经过节点 ${required(document.nodes.find((n) => n.id === id)).code} 的区域`,
            },
          ],
        )
      }
    }
}
