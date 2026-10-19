/** @fileoverview 编辑节点尺寸、对齐与辅助线。 */
import type { GraphNode } from './types'

export const editorSize = (node: Pick<GraphNode, 'kind'>) => ({
  width: 208,
  height: node.kind === 'junction' ? 56 : 148,
})
export type Alignment =
  | 'left'
  | 'center'
  | 'right'
  | 'top'
  | 'middle'
  | 'bottom'
  | 'horizontal'
  | 'vertical'
export type Positioned = Pick<GraphNode, 'id' | 'kind' | 'position'>

export function alignNodes(
  nodes: Positioned[],
  action: Alignment,
): { id: string; position: { x: number; y: number } }[] {
  if (nodes.length < (action === 'horizontal' || action === 'vertical' ? 3 : 2))
    return []
  const axis = ['left', 'center', 'right', 'horizontal'].includes(action)
    ? 'x'
    : 'y'
  const dimension = axis === 'x' ? 'width' : 'height'
  const start = Math.min(...nodes.map((n) => n.position[axis]))
  const end = Math.max(
    ...nodes.map((n) => n.position[axis] + editorSize(n)[dimension]),
  )
  if (action === 'horizontal' || action === 'vertical') {
    const ordered = [...nodes].sort(
      (a, b) => a.position[axis] - b.position[axis] || a.id.localeCompare(b.id),
    )
    const total = ordered.reduce((sum, n) => sum + editorSize(n)[dimension], 0)
    const gap = Math.max(0, (end - start - total) / (ordered.length - 1))
    let cursor = start
    return ordered.map((n) => {
      const position = { ...n.position, [axis]: Math.round(cursor) }
      cursor += editorSize(n)[dimension] + gap
      return { id: n.id, position }
    })
  }
  return nodes.map((n) => ({
    id: n.id,
    position: {
      ...n.position,
      [axis]: Math.round(
        action === 'left' || action === 'top'
          ? start
          : action === 'right' || action === 'bottom'
            ? end - editorSize(n)[dimension]
            : (start + end - editorSize(n)[dimension]) / 2,
      ),
    },
  }))
}

export interface Guide {
  axis: 'x' | 'y'
  value: number
}
export function snapGuides(
  moving: Positioned[],
  stationary: Positioned[],
  tolerance: number,
): { dx: number; dy: number; guides: Guide[] } {
  const guides: Guide[] = []
  const delta = { x: 0, y: 0 }
  for (const axis of ['x', 'y'] as const) {
    const distance = tolerance + 0.001
    const nearest: NearestGuide = { distance, delta: 0, chosen: undefined }
    for (const node of moving)
      for (const peer of stationary) scanGuides(node, peer, axis, nearest)
    delta[axis] = nearest.delta
    const chosen = nearest.chosen
    if (chosen !== undefined) guides.push({ axis, value: chosen })
  }
  return { dx: delta.x, dy: delta.y, guides }
}

interface NearestGuide {
  distance: number
  delta: number
  chosen: number | undefined
}
function scanGuides(
  node: Positioned,
  peer: Positioned,
  axis: 'x' | 'y',
  nearest: NearestGuide,
) {
  const size = axis === 'x' ? 'width' : 'height'
  for (const offset of [0, 0.5, 1])
    for (const targetOffset of [0, 0.5, 1]) {
      const target = peer.position[axis] + editorSize(peer)[size] * targetOffset
      const difference =
        target - node.position[axis] - editorSize(node)[size] * offset
      if (Math.abs(difference) < nearest.distance) {
        nearest.distance = Math.abs(difference)
        nearest.delta = difference
        nearest.chosen = target
      }
    }
}
