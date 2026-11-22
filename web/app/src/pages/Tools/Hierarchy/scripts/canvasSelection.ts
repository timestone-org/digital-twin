/** @fileoverview 节点拖动的对齐与框选范围计算。 */
import type { Pointer } from './canvasGeometry'
import { editorSize, snapGuides } from './geometry'
import type { GraphNode } from './types'

interface NodeDrag {
  original: readonly GraphNode[]
  selectedIds: readonly string[]
  start: Pointer
  current: Pointer
  zoom: number
  snap: boolean
  showGuides: boolean
}

/** 计算拖动期间预览的节点位置与辅助线。 */
export function dragNodes(input: NodeDrag) {
  const selected = new Set(input.selectedIds)
  let moving = input.original
    .filter((node) => selected.has(node.id))
    .map((node) => ({
      ...node,
      position: {
        x: node.position.x + input.current.x - input.start.x,
        y: node.position.y + input.current.y - input.start.y,
      },
    }))
  if (input.snap)
    moving = moving.map((node) => ({
      ...node,
      position: {
        x: Math.round(node.position.x / 10) * 10,
        y: Math.round(node.position.y / 10) * 10,
      },
    }))
  const adjustment = input.showGuides
    ? snapGuides(
        moving,
        input.original.filter((node) => !selected.has(node.id)),
        6 / input.zoom,
      )
    : { dx: 0, dy: 0, guides: [] }
  const positions = new Map(
    moving.map((node) => [
      node.id,
      {
        x: node.position.x + adjustment.dx,
        y: node.position.y + adjustment.dy,
      },
    ]),
  )
  return {
    guides: adjustment.guides,
    nodes: input.original.map((node) => ({
      ...node,
      position: positions.get(node.id) ?? node.position,
    })),
  }
}

/** 按拖动两端计算框选范围。 */
export function selectionBounds(start: Pointer, end: Pointer | null) {
  return end === null
    ? null
    : {
        x: Math.min(start.x, end.x),
        y: Math.min(start.y, end.y),
        width: Math.abs(start.x - end.x),
        height: Math.abs(start.y - end.y),
      }
}

/** 取完整落入框选范围的节点。 */
export function nodesInBox(
  nodes: readonly GraphNode[],
  box: Pointer & { width: number; height: number },
): string[] {
  return nodes
    .filter(
      (node) =>
        node.position.x >= box.x &&
        node.position.x + editorSize(node).width <= box.x + box.width &&
        node.position.y >= box.y &&
        node.position.y + editorSize(node).height <= box.y + box.height,
    )
    .map((node) => node.id)
}
