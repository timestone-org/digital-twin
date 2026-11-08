/**
 * @fileoverview 悬浮卡避让的纯几何：卡片朝某一侧弹出会越出舞台时，判断翻到节点另一侧
 * 是否更好，并给出两段镜像位移。只算一维（竖轴），不碰 DOM。口径见
 * docs/MODULE_TWIN_2D_DESIGN.md §9.3。
 */

/** 竖轴上的一段区间（同一坐标系下的屏幕像素）。 */
export interface Twin2dSpan {
  start: number
  end: number
}

/** 判「卡片整个在节点某一侧」时容忍的像素误差（亚像素取整） */
const SIDE_EPSILON = 0.5

/**
 * 一段区间越出边界多少；不越出为 0。
 * @param span 区间
 * @param bounds 边界
 */
function overflowOf(span: Twin2dSpan, bounds: Twin2dSpan): number {
  return (
    Math.max(0, bounds.start - span.start) + Math.max(0, span.end - bounds.end)
  )
}

/**
 * 卡片翻到节点另一侧要挪多少；不需要或翻了也不更好时为 `null`。
 * ⚠ 只认「整个在节点上方或下方」的卡片：压在节点身上的图元没有「另一侧」，
 * 硬翻会把它甩到离节点一整个身位之外。
 * ⚠ 翻过去仍越界时按越界量比：两边都放不下（舞台比卡片还矮）时留在越得少的那边。
 * @param node 节点的竖向区间
 * @param popup 卡片的竖向区间
 * @param bounds 舞台可见区的竖向区间
 */
export function popupFlipOffset(
  node: Twin2dSpan,
  popup: Twin2dSpan,
  bounds: Twin2dSpan,
): number | null {
  const height = popup.end - popup.start
  const below = popup.start >= node.end - SIDE_EPSILON
  const above = popup.end <= node.start + SIDE_EPSILON
  if (!below && !above) return null
  const current = overflowOf(popup, bounds)
  if (current <= 0) return null
  // 镜像：卡片与节点之间的间距原样搬到另一侧
  const start = below
    ? node.start - (popup.start - node.end) - height
    : node.end + (node.start - popup.end)
  const mirrored = overflowOf({ start, end: start + height }, bounds)
  return mirrored < current ? start - popup.start : null
}

/**
 * 卡片翻转后，贴在卡片某条边上的子图元（箭头）跟着镜像要挪多少：以卡片中线为轴对折。
 * @param popupHeight 卡片高度
 * @param childTop 子图元上沿到卡片上沿的距离
 * @param childHeight 子图元高度
 */
export function mirroredChildOffset(
  popupHeight: number,
  childTop: number,
  childHeight: number,
): number {
  return popupHeight - 2 * childTop - childHeight
}
