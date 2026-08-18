/**
 * @fileoverview 原生 `title` 的接管三件事：从事件找到它、把它摘下来、再装回去。
 * 摘掉才不会弹系统气泡；装回去是为了静止态的 DOM 与无障碍树跟没接管时逐字相同
 * （axe 扫的正是静止态）。
 */

/** 这两类的 title 不是悬停提示：iframe 的是无障碍名，svg 的提示走 `<title>` 子元素。 */
const SKIP_TAGS = new Set(['IFRAME', 'SVG'])

/** 一只被摘下来、等着装回去的 title。 */
export interface HeldTitle {
  el: HTMLElement
  text: string
}

/**
 * 这次事件真正落在哪个元素上。
 *
 * ⚠ 不直接用 `event.target`：**禁用**的控件不派发任何鼠标事件，事件打在它的祖先
 * 上，而系统气泡照弹不误——只有命中测试指得到它本身。命中点落到 target 之外说明
 * 这次测不准（没有命中测试的环境会退化成整页命中），那就宁可信 target。
 * @param event 指针或焦点事件
 */
export function pointOf(event: Event): Element | null {
  const target = event.target instanceof Element ? event.target : null
  if (
    target === null ||
    !(event instanceof MouseEvent) ||
    typeof document.elementFromPoint !== 'function'
  ) {
    return target
  }
  const hit = document.elementFromPoint(event.clientX, event.clientY)
  return hit !== null && hit !== target && target.contains(hit) ? hit : target
}

/**
 * 从命中的元素往上找出该给谁弹提示。
 * @param from 命中的元素
 * @param held 此刻已经接管着的那只；它的 title 已被摘走，选择器找不到它
 */
export function anchorOf(
  from: Element | null,
  held: HTMLElement | null,
): HTMLElement | null {
  if (from === null) return null
  // 指针还落在已接管的那只身上就别换人——它的 title 不在了，重找必然找到别人
  if (held !== null && held.contains(from)) return held
  let node = from.closest<HTMLElement>('[title]')
  while (node !== null) {
    if (!SKIP_TAGS.has(node.tagName.toUpperCase())) return node
    node = node.parentElement?.closest<HTMLElement>('[title]') ?? null
  }
  return null
}

/**
 * 把元素上的 title 摘下来；空白的 title 不值得弹，摘了也没用。
 * @param el 要接管的元素
 */
export function holdTitle(el: HTMLElement): HeldTitle | null {
  const text = el.getAttribute('title') ?? ''
  if (text.trim() === '') return null
  el.removeAttribute('title')
  return { el, text }
}

/**
 * 把摘下来的 title 装回去。元素已经离开文档就作罢，装回去只会把它留在内存里。
 * @param held 摘下来的那一只
 */
export function releaseTitle(held: HeldTitle | null): void {
  if (held === null || !held.el.isConnected) return
  // 期间被重新写上了就以新的为准，别用手上这份旧的盖掉
  if (!held.el.hasAttribute('title')) held.el.setAttribute('title', held.text)
}
