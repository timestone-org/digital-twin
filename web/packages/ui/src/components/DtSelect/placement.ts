/**
 * @fileoverview 下拉浮层的定位与层级计算。纯函数，不碰 DOM 以外的状态。
 */

/** 与 @dt/tokens 的 --z-dropdown 对齐。JS 侧读不到构建期的 var，改标尺时两边一起改。 */
const DROPDOWN_Z = 300

export interface MenuPositionInput {
  /** trigger 的视口矩形（`getBoundingClientRect()` 的子集）。 */
  trigger: { top: number; bottom: number; left: number; width: number }
  /** 浮层实测高度。未渲染完成时传 0，按「总能放下」处理，不翻转。 */
  menuHeight: number
  viewportWidth: number
  viewportHeight: number
  placement: 'bottom' | 'top'
  /** trigger 与浮层的间距。 */
  gutter?: number
}

export interface MenuPositionResult {
  /** 实际方向，可能因空间不足而与传入的相反。 */
  placement: 'bottom' | 'top'
  style: Record<string, string>
}

/**
 * 算出浮层的 fixed 坐标：竖直方向按剩余空间翻转，水平方向对齐 trigger 并夹在视口内。
 * @param input trigger 矩形、浮层高度、视口尺寸与首选方向
 */
export function computeMenuPosition(
  input: MenuPositionInput,
): MenuPositionResult {
  const { trigger, menuHeight, viewportWidth, viewportHeight } = input
  const gutter = input.gutter ?? 6
  const spaceBelow = viewportHeight - trigger.bottom
  const spaceAbove = trigger.top

  let placement = input.placement
  // 高度为 0 表示还没量到，按契约视为放得下——首帧先落首选方向，量到后再校正
  if (menuHeight > 0) {
    const needed = menuHeight + gutter
    if (
      placement === 'bottom' &&
      spaceBelow < needed &&
      spaceAbove > spaceBelow
    ) {
      placement = 'top'
    } else if (
      placement === 'top' &&
      spaceAbove < needed &&
      spaceBelow > spaceAbove
    ) {
      placement = 'bottom'
    }
  }

  // 右边界会把宽浮层推出视口，向左收；再夹一次左边界，窄视口下优先保左边
  const left = Math.max(
    0,
    Math.min(trigger.left, viewportWidth - trigger.width),
  )
  const style: Record<string, string> = {
    position: 'fixed',
    left: `${left}px`,
    width: `${trigger.width}px`,
  }
  if (placement === 'bottom') {
    style.top = `${trigger.bottom + gutter}px`
  } else {
    style.bottom = `${viewportHeight - trigger.top + gutter}px`
  }
  return { placement, style }
}

/**
 * teleport 到 body 的浮层该占的 z-index。
 *
 * ⚠ 浮层脱离了宿主的堆叠上下文，静态的 `--z-dropdown` (300) 会被 DtModal (500)
 * 这类更高的宿主压在下面——在弹窗里展开下拉，列表会藏到遮罩后面。
 * 沿 trigger 的祖先链取最大的 z-index 再 +1：弹窗里浮在弹窗之上，普通页面里仍是 300。
 * @param from trigger 元素
 */
export function resolveOverlayZIndex(from: HTMLElement | null): number {
  if (from === null || typeof getComputedStyle !== 'function') {
    return DROPDOWN_Z
  }
  let hostZ = 0
  for (
    let node: HTMLElement | null = from;
    node !== null && node !== document.body;
    node = node.parentElement
  ) {
    const z = Number.parseInt(getComputedStyle(node).zIndex, 10)
    if (!Number.isNaN(z)) hostZ = Math.max(hostZ, z)
  }
  return Math.max(DROPDOWN_Z, hostZ + 1)
}
