/**
 * @fileoverview 悬浮卡避让的 DOM 一侧：进入节点那一刻量出「hover 才显形」的卡片，越出舞台
 * 且翻到另一侧更好时，用独立的 `translate` / `scale` 两条属性把卡片与贴边的箭头镜像过去。
 * 几何判断全在 `../popupFlip`。口径见 docs/MODULE_TWIN_2D_DESIGN.md §9.3。
 */
import { mirroredChildOffset, popupFlipOffset } from '../popupFlip'
import type { Twin2dSpan } from '../popupFlip'

/** 被本模块挪过的元素打的标记，下次进入前凭它复原 */
const FLIP_ATTR = 'data-t2-flipped'
/** 舞台根：它的 `overflow: hidden` 就是卡片看得见的边界 */
const STAGE_SELECTOR = '.t2-stage'
/** 视口：设计坐标系整块缩放在它身上 */
const VIEWPORT_SELECTOR = '.t2-stage__viewport'
/** 静止态透明度为 0 = 只在 hover 时显形的卡片 */
const HIDDEN_OPACITY = '0'
/** 竖向镜像箭头这类矢量件 */
const MIRROR_Y = '1 -1'

/**
 * 元素的竖向屏幕区间。
 * @param el 元素
 */
function spanOf(el: Element): Twin2dSpan {
  const rect = el.getBoundingClientRect()
  return { start: rect.top, end: rect.bottom }
}

/**
 * 是不是「只在 hover 时显形、不吃指针、脱离文档流」的悬浮卡。
 * ⚠ 读内联样式而不是计算样式：进入那一刻变体还没重绘，内联值就是静止态；
 * 计算样式在淡出过渡里会读到半透明的中间值，于是快速移回时卡片不再被认出来。
 * ⚠ 传感器药丸这类常显的 `pointerEvents: 'none'` 图元透明度是 1，不会被误挪。
 * @param el 节点根下的一个图元元素
 */
function isHoverPopup(el: HTMLElement): boolean {
  return (
    el.style.opacity === HIDDEN_OPACITY &&
    el.style.pointerEvents === 'none' &&
    el.style.position === 'absolute'
  )
}

/**
 * 记下一次挪动：独立的 `translate` 叠在图元自己的 `transform` 之外，Vue 不写这一项，
 * 故重绘不会把它冲掉，复原也只摘这一项。
 * @param el 被挪的元素
 * @param dy 竖向位移（元素父级坐标系的像素）
 * @param mirror 是否同时竖向镜像
 */
function shift(
  el: HTMLElement | SVGElement,
  dy: number,
  mirror: boolean,
): void {
  el.style.setProperty('translate', `0 ${dy}px`)
  if (mirror) el.style.setProperty('scale', MIRROR_Y)
  el.setAttribute(FLIP_ATTR, '')
}

/**
 * 卡片里贴边的子图元（箭头）以卡片中线对折；矢量件同时竖向镜像，让尖朝向节点。
 * ⚠ 文字与流内子图元不动：镜像文字会倒过来，流内的行由卡片自己排。
 * @param popup 已翻转的卡片
 * @param popupSpan 卡片翻转前的屏幕区间
 */
function mirrorEdgeChildren(popup: HTMLElement, popupSpan: Twin2dSpan): void {
  const height = popupSpan.end - popupSpan.start
  // 卡片内部坐标 → 屏幕的倍率，含舞台缩放与卡片静止态的那一点缩放
  const scale = popup.offsetHeight > 0 ? height / popup.offsetHeight : 0
  if (scale <= 0) return
  for (const child of Array.from(popup.children)) {
    if (!(child instanceof HTMLElement || child instanceof SVGElement)) continue
    if (child.style.position !== 'absolute') continue
    const span = spanOf(child)
    const dy = mirroredChildOffset(
      height,
      span.start - popupSpan.start,
      span.end - span.start,
    )
    shift(child, dy / scale, child instanceof SVGElement)
  }
}

/**
 * 摘掉上一次挪动，回到样式给的原位。
 * @param root 节点根元素
 */
export function resetHoverPopups(root: HTMLElement): void {
  for (const el of Array.from(root.querySelectorAll(`[${FLIP_ATTR}]`))) {
    if (!(el instanceof HTMLElement || el instanceof SVGElement)) continue
    el.style.removeProperty('translate')
    el.style.removeProperty('scale')
    el.removeAttribute(FLIP_ATTR)
  }
}

/**
 * 进入节点时调用：先复原，再把会越出舞台的悬浮卡翻到节点另一侧。
 * ⚠ 必须在 hover 变体重绘**之前**调：卡片此刻透明，挪动不可见；等它显形后再挪，
 * 用户会看见卡片先朝下弹、再跳到上面。
 * ⚠ 不在舞台里（编辑画布的拖拽预览等）就什么都不做。
 * @param root 节点根元素
 */
export function flipHoverPopups(root: HTMLElement): void {
  resetHoverPopups(root)
  const stage = root.closest(STAGE_SELECTOR)
  const viewport = root.closest(VIEWPORT_SELECTOR)
  if (!(viewport instanceof HTMLElement) || stage === null) return
  const viewportSpan = spanOf(viewport)
  const offsetHeight = viewport.offsetHeight
  if (offsetHeight <= 0) return
  // 设计像素 → 屏幕像素的竖向倍率
  const stageScale = (viewportSpan.end - viewportSpan.start) / offsetHeight
  if (stageScale <= 0) return
  const bounds = spanOf(stage)
  const node = spanOf(root)
  for (const child of Array.from(root.children)) {
    if (!(child instanceof HTMLElement) || !isHoverPopup(child)) continue
    const popupSpan = spanOf(child)
    const dy = popupFlipOffset(node, popupSpan, bounds)
    if (dy === null) continue
    shift(child, dy / stageScale, false)
    mirrorEdgeChildren(child, popupSpan)
  }
}
