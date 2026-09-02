/**
 * @fileoverview 右键菜单的落点钳位。
 *
 * ⚠ 必须双向锁边：只锁右下的话，小视口里菜单会被顶出左上角，前几项永远点不到。
 * ⚠ 高度按**当前条目数**估而不是按最长的那份写死：这个菜单的长度随选中几张卡片
 * 变化，按最长的估会让短菜单被顶得离指针老远，看着像点歪了。
 */

/** 菜单宽度，与样式表里的 `min-width` 一致。 */
const MENU_WIDTH = 208
/** 一条菜单项与一条分隔线各占的高度，加上菜单自己的上下内边距。 */
const ITEM_HEIGHT = 32
const SEPARATOR_HEIGHT = 9
const MENU_PADDING = 8

/** 与视口边缘的最小留白。 */
const GAP = 8

/** 一份菜单大概有多高。 */
export function menuHeightOf(items: number, groups: number): number {
  const separators = Math.max(0, groups - 1)
  return MENU_PADDING + items * ITEM_HEIGHT + separators * SEPARATOR_HEIGHT
}

/** 把落点钳进视口。`size` 是这份菜单的条目数与分组数。 */
export function clampMenu(
  at: { x: number; y: number },
  viewport: { width: number; height: number },
  size: { items: number; groups: number },
): { x: number; y: number } {
  const height = menuHeightOf(size.items, size.groups)
  return {
    x: Math.max(GAP, Math.min(at.x, viewport.width - MENU_WIDTH - GAP)),
    y: Math.max(GAP, Math.min(at.y, viewport.height - height - GAP)),
  }
}
