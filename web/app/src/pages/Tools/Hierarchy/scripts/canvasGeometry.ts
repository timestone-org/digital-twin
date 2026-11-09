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
/** 适应全部的最小缩放：再小节点名就读不出来，宁可让人平移。 */
const MIN_FIT_ZOOM = 0.4
/** 画布四周留白。 */
const FIT_MARGIN = 40
/** 右下角缩放工具条占的高度，取景时让开它。 */
const ZOOM_BAR_HEIGHT = 48

/**
 * 让节点落进画布的视口；内容大到要缩到 40% 以下时停在 40%，从内容左上角开始看。
 * @param nodes 要取景的节点
 * @param width 画布宽
 * @param height 画布高
 */
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
  const usableHeight = height - ZOOM_BAR_HEIGHT
  const fitted = Math.min(
    1,
    (width - FIT_MARGIN * 2) / (right - left),
    (usableHeight - FIT_MARGIN * 2) / (bottom - top),
  )
  if (fitted < MIN_FIT_ZOOM)
    return {
      x: FIT_MARGIN - left * MIN_FIT_ZOOM,
      y: FIT_MARGIN - top * MIN_FIT_ZOOM,
      zoom: MIN_FIT_ZOOM,
    }
  return {
    x: (width - (right + left) * fitted) / 2,
    y: (usableHeight - (bottom + top) * fitted) / 2,
    zoom: fitted,
  }
}
