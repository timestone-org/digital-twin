/**
 * @fileoverview 框选手势：按住 Shift 拖出一个框，松手交出框住的区域。
 * 只管手势与那块提示用的 DOM，框中了谁由 `marqueeSelect` 算。
 *
 * ⚠ 框自己不吃指针事件：吃了的话拖到一半光标进了框内，后续的 pointermove
 * 会打到框上，框就停在那儿不动了。
 */
import { rectFromPoints, type ScreenRect } from './marqueeSelect'

/** 拖出这么多像素才算在框选，低于它当成手抖。 */
const MIN_DRAG_PX = 4

export interface MarqueeGestureOptions {
  /** 框贴在这个元素里，坐标按它的左上角算。 */
  host: () => HTMLElement | null
  /** 拖完了，交出屏幕坐标下的框；小于阈值的框不会走到这里。 */
  onFinish: (rect: ScreenRect) => void
}

/**
 * 框选手势。宿主在指针事件里转交，卸载时 `dispose`。
 */
export class MarqueeGesture {
  private readonly options: MarqueeGestureOptions
  private element: HTMLDivElement | null = null
  private startX = 0
  private startY = 0
  private active = false

  constructor(options: MarqueeGestureOptions) {
    this.options = options
  }

  /** 正在框选——宿主据此让轨道控制器让位。 */
  get isActive(): boolean {
    return this.active
  }

  /**
   * 按下。
   * @param event 指针事件
   * @returns 接管了这一下就是 true，宿主不要再当成普通点击
   */
  down(event: PointerEvent): boolean {
    if (!event.shiftKey || event.button !== 0) return false
    this.startX = event.clientX
    this.startY = event.clientY
    this.active = true
    return true
  }

  /** 拖动中；到了阈值才真的画出框来。 */
  move(event: PointerEvent): void {
    if (!this.active) return
    const rect = rectFromPoints(
      this.startX,
      this.startY,
      event.clientX,
      event.clientY,
    )
    if (rect.width < MIN_DRAG_PX && rect.height < MIN_DRAG_PX) return
    this.paint(rect)
  }

  /**
   * 松手。
   * @param event 指针事件
   * @returns 这一下是一次框选就是 true
   */
  up(event: PointerEvent): boolean {
    if (!this.active) return false
    this.active = false
    this.clear()
    const rect = rectFromPoints(
      this.startX,
      this.startY,
      event.clientX,
      event.clientY,
    )
    // 太小的框当成手抖：不给它去选一片，否则轻轻一动就选中一堆
    if (rect.width < MIN_DRAG_PX || rect.height < MIN_DRAG_PX) return false
    this.options.onFinish(rect)
    return true
  }

  /** 指针被系统收走：把框收掉，别留一个删不掉的方块在画面上。 */
  cancel(): void {
    this.active = false
    this.clear()
  }

  dispose(): void {
    this.cancel()
  }

  private paint(rect: ScreenRect): void {
    const host = this.options.host()
    if (host === null) return
    const box = this.element ?? this.create(host)
    const origin = host.getBoundingClientRect()
    box.style.left = `${rect.left - origin.left}px`
    box.style.top = `${rect.top - origin.top}px`
    box.style.width = `${rect.width}px`
    box.style.height = `${rect.height}px`
    box.style.display = 'block'
  }

  private create(host: HTMLElement): HTMLDivElement {
    const box = document.createElement('div')
    box.className = 'twin-marquee'
    box.dataset.test = 'twin-marquee'
    box.style.position = 'absolute'
    // ⚠ 不吃指针事件：吃了之后光标一进框内，后续 pointermove 打在框上，
    // 框就停住不动了
    box.style.pointerEvents = 'none'
    // 外观走主题变量而不是写死的色值：这块 DOM 是手势自己造的，进不了样式表
    box.style.border = '1px solid var(--accent-primary)'
    box.style.background =
      'color-mix(in srgb, var(--accent-primary) 12%, transparent)'
    box.style.borderRadius = 'var(--radius-sm)'
    box.style.zIndex = '5'
    host.append(box)
    this.element = box
    return box
  }

  private clear(): void {
    this.element?.remove()
    this.element = null
  }
}
