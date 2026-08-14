/**
 * @fileoverview token 的运行时读取面。样式一律走 CSS 变量，这里只给需要
 * 拿到具体数值的场景（画布、图表）用。
 */

/** 控件尺寸轴的像素值，与 tokens.css 的 --ctl-h-* 同源。 */
export const CONTROL_SIZE_PX = {
  sm: 32,
  md: 40,
  lg: 48,
} as const

/**
 * 读一个 CSS 变量的计算值；变量缺席时返回兜底值。
 * @param name 变量名，含前导 `--`
 * @param fallback 变量缺席时的取值
 * @param host 读级联的宿主元素，缺省用文档根
 */
export function readToken(
  name: string,
  fallback: string,
  host?: Element | null,
): string {
  if (typeof window === 'undefined') return fallback
  const target = host ?? document.documentElement
  const value = getComputedStyle(target).getPropertyValue(name).trim()
  return value || fallback
}

/** 换肤只会动这两个属性：内联变量写在 style 上，明暗档位挂在 class 上。 */
const THEME_ATTRS = ['style', 'class']

/**
 * 侦测换肤：主题引擎把 token 写成宿主元素的内联变量，任一祖先的 `style` /
 * `class` 变了就意味着当前级联下的取值可能变了。返回取消观察的函数。
 * ⚠ 从 `host` 的**父节点**起算：写变量的是舞台根而不是 host 自己，
 * 只观察 host 会一次回调都收不到。
 * @param host 起算元素，通常是组件根
 * @param onChange 主题可能变化时的回调，同一批变更可能连着来多次
 */
export function observeThemeChange(
  host: Element,
  onChange: () => void,
): () => void {
  if (typeof MutationObserver === 'undefined') return () => {}
  const observers: MutationObserver[] = []
  let node = host.parentElement
  while (node) {
    const observer = new MutationObserver(onChange)
    observer.observe(node, { attributes: true, attributeFilter: THEME_ATTRS })
    observers.push(observer)
    if (node === document.documentElement) break
    node = node.parentElement
  }
  return () => {
    for (const observer of observers) observer.disconnect()
  }
}
