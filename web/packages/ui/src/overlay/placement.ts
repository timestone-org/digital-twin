/**
 * @fileoverview 浮层的定位与层级计算，全包共用。纯函数，不碰 DOM 以外的状态。
 * 宽度跟随触发器的下拉走 computeMenuPosition，内容自适应宽度的走 computeAnchoredPosition。
 */

/** 与 @dt/tokens 的 --z-dropdown 对齐。JS 侧读不到构建期的 var，改标尺时两边一起改。 */
const DROPDOWN_Z = 300
/** 浮层与视口边缘的最小留白 */
const VIEWPORT_MARGIN = 8
/** 箭头离浮层两端的安全距离，再近就顶到圆角上了 */
const ARROW_INSET = 10

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

export interface MenuMeasureInput {
  root: HTMLElement | null
  menuHeight: number
  placement: 'bottom' | 'top'
}

/**
 * 量一次触发器并算出浮层的行内样式；root 还没挂上时给空样式。
 * @param input 触发器所在元素、浮层实测高度、首选方向
 */
export function measureMenu(input: MenuMeasureInput): Record<string, string> {
  const rect = input.root?.getBoundingClientRect()
  if (rect === undefined) return {}
  const position = computeMenuPosition({
    trigger: rect,
    menuHeight: input.menuHeight,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    placement: input.placement,
  })
  return {
    ...position.style,
    zIndex: String(resolveOverlayZIndex(input.root)),
  }
}

export const DT_OVERLAY_SIDES = ['top', 'bottom', 'left', 'right'] as const
export type DtOverlaySide = (typeof DT_OVERLAY_SIDES)[number]
export type DtOverlayAlign = 'start' | 'center' | 'end'

export interface AnchoredRect {
  top: number
  bottom: number
  left: number
  right: number
}

export interface AnchoredPositionInput {
  trigger: AnchoredRect
  /** 浮层实测尺寸。首帧量不到时传 0，按「总能放下」处理，不翻转。 */
  overlay: { width: number; height: number }
  viewportWidth: number
  viewportHeight: number
  side: DtOverlaySide
  /** 沿自由轴的对齐，缺省居中。 */
  align?: DtOverlayAlign
  /** 触发器与浮层的间距。 */
  gutter?: number
}

export interface AnchoredPositionResult {
  /** 实际方向，可能因空间不足翻到对面。 */
  side: DtOverlaySide
  style: Record<string, string>
  /** 箭头相对浮层起边的偏移。浮层被夹到视口边之后，箭头仍要指着触发器中心。 */
  arrowOffset: number
}

const OPPOSITE: Record<DtOverlaySide, DtOverlaySide> = {
  top: 'bottom',
  bottom: 'top',
  left: 'right',
  right: 'left',
}

/** hi < lo（视口比浮层还窄）时取 lo，保证左上角始终可见。 */
function clamp(value: number, lo: number, hi: number): number {
  return hi < lo ? lo : Math.min(Math.max(value, lo), hi)
}

function isVertical(side: DtOverlaySide): boolean {
  return side === 'top' || side === 'bottom'
}

function spaceOn(input: AnchoredPositionInput, side: DtOverlaySide): number {
  const { trigger } = input
  if (side === 'top') return trigger.top
  if (side === 'bottom') return input.viewportHeight - trigger.bottom
  if (side === 'left') return trigger.left
  return input.viewportWidth - trigger.right
}

/** 空间不够**且对面更宽裕**才翻，否则翻过去只是换个地方被裁。 */
function resolveSide(input: AnchoredPositionInput): DtOverlaySide {
  const extent = isVertical(input.side)
    ? input.overlay.height
    : input.overlay.width
  if (extent <= 0) return input.side
  const needed = extent + (input.gutter ?? VIEWPORT_MARGIN)
  const here = spaceOn(input, input.side)
  const there = spaceOn(input, OPPOSITE[input.side])
  return here < needed && there > here ? OPPOSITE[input.side] : input.side
}

/** 主轴：贴着触发器的那一边，留出 gutter。 */
function mainAxis(input: AnchoredPositionInput, side: DtOverlaySide): number {
  const gutter = input.gutter ?? VIEWPORT_MARGIN
  const { trigger, overlay } = input
  if (side === 'bottom') return trigger.bottom + gutter
  if (side === 'top') return trigger.top - gutter - overlay.height
  if (side === 'right') return trigger.right + gutter
  return trigger.left - gutter - overlay.width
}

/** 自由轴：按 align 贴边或居中，再夹进视口。 */
function crossAxis(input: AnchoredPositionInput, side: DtOverlaySide): number {
  const vertical = isVertical(side)
  const { trigger, overlay } = input
  const start = vertical ? trigger.left : trigger.top
  const end = vertical ? trigger.right : trigger.bottom
  const extent = vertical ? overlay.width : overlay.height
  const limit = vertical ? input.viewportWidth : input.viewportHeight

  const align = input.align ?? 'center'
  let offset = (start + end) / 2 - extent / 2
  if (align === 'start') offset = start
  else if (align === 'end') offset = end - extent

  return clamp(offset, VIEWPORT_MARGIN, limit - extent - VIEWPORT_MARGIN)
}

/**
 * 算出内容自适应尺寸的浮层坐标：主轴按剩余空间翻转，自由轴按 align 贴边后夹进视口。
 * @param input 触发器矩形、浮层实测尺寸、视口尺寸与首选方向
 */
export function computeAnchoredPosition(
  input: AnchoredPositionInput,
): AnchoredPositionResult {
  const side = resolveSide(input)
  const vertical = isVertical(side)
  const main = mainAxis(input, side)
  const cross = crossAxis(input, side)
  const { trigger, overlay } = input

  const center = vertical
    ? (trigger.left + trigger.right) / 2
    : (trigger.top + trigger.bottom) / 2
  const extent = vertical ? overlay.width : overlay.height

  return {
    side,
    style: {
      position: 'fixed',
      top: `${vertical ? main : cross}px`,
      left: `${vertical ? cross : main}px`,
    },
    arrowOffset: clamp(
      center - cross,
      ARROW_INSET,
      Math.max(ARROW_INSET, extent - ARROW_INSET),
    ),
  }
}

export interface AnchoredMeasureInput {
  trigger: HTMLElement | null
  overlay: HTMLElement | null
  side: DtOverlaySide
  align?: DtOverlayAlign
  gutter?: number
}

/**
 * 量一次触发器与浮层，算出行内样式与箭头偏移；触发器还没挂上时返回 null。
 * @param input 触发器与浮层元素、首选方向与对齐
 */
export function measureAnchored(
  input: AnchoredMeasureInput,
): AnchoredPositionResult | null {
  const rect = input.trigger?.getBoundingClientRect()
  if (rect === undefined) return null
  const placed = computeAnchoredPosition({
    trigger: rect,
    overlay: {
      width: input.overlay?.offsetWidth ?? 0,
      height: input.overlay?.offsetHeight ?? 0,
    },
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    side: input.side,
    // ⚠ exactOptionalPropertyTypes 下不能直接传 undefined，那与「不传」不是一回事
    ...(input.align === undefined ? {} : { align: input.align }),
    ...(input.gutter === undefined ? {} : { gutter: input.gutter }),
  })
  return {
    ...placed,
    style: {
      ...placed.style,
      zIndex: String(resolveOverlayZIndex(input.trigger)),
    },
  }
}
