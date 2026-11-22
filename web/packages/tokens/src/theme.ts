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

/** 主题可能由内联样式或样式类改变。 */
const THEME_ATTRS = ['style', 'class']

interface ThemeObservation {
  themeTarget?: Element
  onLayoutChange?: () => void
}

/** 读取级联变量与图表兜底前景色。 */
function computedTheme(target: Element): Map<string, string> {
  const style = getComputedStyle(target)
  const values = new Map([['color', style.color]])
  for (let index = 0; index < style.length; index += 1) {
    const name = style.item(index)
    if (name.startsWith('--')) values.set(name, style.getPropertyValue(name))
  }
  return values
}

/** 比较两次级联结果，忽略属性排列顺序。 */
function themeChanged(
  previous: Map<string, string>,
  current: Map<string, string>,
): boolean {
  if (previous.size !== current.size) return true
  for (const [name, value] of current) {
    if (previous.get(name) !== value) return true
  }
  return false
}

/**
 * 观察祖先的换肤并返回解除函数。
 * @param host 起算元素，通常是组件根
 * @param onChange 当前生效的主题变化时回调
 * @param options 读取主题的元素，以及需要复查布局时的回调
 */
export function observeThemeChange(
  host: Element,
  onChange: () => void,
  { themeTarget = host, onLayoutChange }: ThemeObservation = {},
): () => void {
  if (typeof MutationObserver === 'undefined') return () => {}
  let previous = computedTheme(themeTarget)
  const observer = new MutationObserver(() => {
    const current = computedTheme(themeTarget)
    if (!themeChanged(previous, current)) {
      onLayoutChange?.()
      return
    }
    previous = current
    onChange()
  })
  let node = host.parentElement
  while (node) {
    observer.observe(node, { attributes: true, attributeFilter: THEME_ATTRS })
    node = node.parentElement
  }
  return () => observer.disconnect()
}
