/** @fileoverview 编辑画布的坐标换算与连接路径。 */
import { editorSize } from './geometry'
import type { GraphDocument, GraphNode } from './types'
export interface Pointer {
  x: number
  y: number
}
export function canvasPoint(
  event: { clientX: number; clientY: number },
  bounds: DOMRect,
  view: GraphDocument['viewport'],
): Pointer {
  return {
    x: (event.clientX - bounds.left - view.x) / view.zoom,
    y: (event.clientY - bounds.top - view.y) / view.zoom,
  }
}
export function edgePath(source: GraphNode, target: GraphNode): string {
  const start = {
    x: source.position.x + 104,
    y: source.position.y + editorSize(source).height,
  }
  const end = { x: target.position.x + 104, y: target.position.y }
  const middle = (start.y + end.y) / 2
  return `M${start.x} ${start.y} V${middle} H${end.x} V${end.y}`
}
export function fitViewport(
  nodes: GraphNode[],
  width: number,
  height: number,
): GraphDocument['viewport'] {
  if (!nodes.length) return { x: 50, y: 40, zoom: 1 }
  const left = Math.min(...nodes.map((node) => node.position.x)),
    top = Math.min(...nodes.map((node) => node.position.y))
  const right = Math.max(
      ...nodes.map((node) => node.position.x + editorSize(node).width),
    ),
    bottom = Math.max(
      ...nodes.map((node) => node.position.y + editorSize(node).height),
    )
  const zoom = Math.max(
    0.05,
    Math.min(1, (width - 80) / (right - left), (height - 80) / (bottom - top)),
  )
  return {
    x: (width - (right + left) * zoom) / 2,
    y: (height - (bottom + top) * zoom) / 2,
    zoom,
  }
}
