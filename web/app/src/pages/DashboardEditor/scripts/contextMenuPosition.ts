/**
 * @fileoverview 画布右键菜单的落点计算。
 * ⚠ 钳位必须双向锁边：只锁右下会在小视口里把菜单顶出左上角。
 */

/**
 * 菜单实测尺寸，按最长的那份（节点菜单：5 项 + 分隔线 + 1 项）的 padding
 * 与字号估算；加项时同步调。估大了会让贴边时的菜单离指针明显偏上。
 */
export const CTX_MENU_WIDTH = 208
export const CTX_MENU_HEIGHT = 240

/** 与视口边缘的最小留白。 */
const GAP = 8

export function clampContextMenu(
  clientX: number,
  clientY: number,
  viewportW: number,
  viewportH: number,
): { x: number; y: number } {
  return {
    x: Math.max(GAP, Math.min(clientX, viewportW - CTX_MENU_WIDTH - GAP)),
    y: Math.max(GAP, Math.min(clientY, viewportH - CTX_MENU_HEIGHT - GAP)),
  }
}
