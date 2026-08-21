/**
 * @fileoverview 浮层的焦点圈养：挂载时聚焦面板、Tab 在面板内折返、
 * 卸载时把焦点归还触发元素。只管焦点；Esc 之类的关闭语义留给宿主。
 */
import { nextTick, onBeforeUnmount, onMounted, type Ref } from 'vue'

/** 可聚焦元素选择器；disabled 与 tabindex=-1 不算。 */
const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * 把 Tab 焦点圈在 `panel` 里；须在组件 setup 期调用（内部挂生命周期钩子）。
 * @param panel 圈养边界元素，须自带 `tabindex="-1"` 以便承接初始焦点
 */
export function useFocusTrap(panel: Ref<HTMLElement | null>): {
  /** 交给宿主在 keydown 里对 Tab 调用。 */
  trapTab: (event: KeyboardEvent) => void
} {
  let previouslyFocused: HTMLElement | null = null

  function focusables(): HTMLElement[] {
    const host = panel.value
    if (host === null) return []
    return [...host.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (element) => element.offsetParent !== null || element === host,
    )
  }

  /** Tab 把焦点圈在面板内：走到头就折返，面板本身也算头。 */
  function trapTab(event: KeyboardEvent): void {
    const list = focusables()
    if (list.length === 0) {
      event.preventDefault()
      panel.value?.focus()
      return
    }
    const first = list[0]
    const last = list[list.length - 1]
    const active = document.activeElement
    const atEdge = event.shiftKey
      ? active === first || active === panel.value
      : active === last
    if (!atEdge) return
    event.preventDefault()
    const wrapTo = event.shiftKey ? last : first
    wrapTo?.focus()
  }

  onMounted(async () => {
    previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null
    await nextTick()
    panel.value?.focus()
  })

  onBeforeUnmount(() => {
    // 焦点归还触发元素，键盘用户不被甩回文档开头
    previouslyFocused?.focus()
  })

  return { trapTab }
}
