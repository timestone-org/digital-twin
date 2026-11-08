/**
 * @fileoverview 测试用：给元素钉死矩形与排版高度。happy-dom 没有排版引擎，两者恒为 0。
 */

/**
 * 钉一个元素的竖向矩形与排版高度。
 * @param el 元素
 * @param top 屏幕上沿
 * @param height 屏幕高度
 * @param offsetHeight 排版高度；缺省与屏幕高度相同
 */
export function pin(
  el: Element,
  top: number,
  height: number,
  offsetHeight = height,
): void {
  el.getBoundingClientRect = () => new DOMRect(0, top, 100, height)
  Object.defineProperty(el, 'offsetHeight', {
    configurable: true,
    value: offsetHeight,
  })
}
