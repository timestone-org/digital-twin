/**
 * @fileoverview DtSelect 浮层的开合与定位状态。抽出来是因为它与「选中什么」
 * 无关：组件那边只剩选项与键盘语义，这边只管浮层挂哪、放哪、什么时候收。
 */
import { nextTick, ref } from 'vue'
import type { Ref } from 'vue'
import { measureMenu } from './placement'
import { useOverlayTracking } from './useOverlayTracking'

/**
 * 浮层暴露出来的那几件事。
 * ⚠ 不写 `InstanceType<typeof DtSelectMenu>`：`.vue` 导出的类型 typescript-eslint
 * 解析不出来，整段会被当成 any 报一片 unsafe。
 */
export interface MenuHandle {
  el: HTMLElement | null
  focusSearch: () => void
  scrollActiveIntoView: () => void
}

export interface SelectMenuOptions {
  placement: () => 'bottom' | 'top'
  /** 展开时要不要把焦点交给搜索框。 */
  hasSearch: () => boolean
  /** 展开时高亮落在哪一项。 */
  initialIndex: () => number
}

export interface SelectMenu {
  isOpen: Ref<boolean>
  query: Ref<string>
  activeIndex: Ref<number>
  style: Ref<Record<string, string>>
  host: Ref<string | HTMLElement>
  root: Ref<HTMLElement | null>
  menu: Ref<MenuHandle | null>
  open: () => void
  close: () => void
  reposition: () => void
}

export function useSelectMenu(options: SelectMenuOptions): SelectMenu {
  const isOpen = ref(false)
  const query = ref('')
  const activeIndex = ref(-1)
  const style = ref<Record<string, string>>({})
  const host = ref<string | HTMLElement>('body')
  const root = ref<HTMLElement | null>(null)
  const menu = ref<MenuHandle | null>(null)

  function reposition(): void {
    if (!isOpen.value) return
    style.value = measureMenu({
      root: root.value,
      menuHeight: menu.value?.el?.offsetHeight ?? 0,
      placement: options.placement(),
    })
  }

  function close(): void {
    if (!isOpen.value) return
    isOpen.value = false
    query.value = ''
    tracking.stop()
  }

  const tracking = useOverlayTracking({ reposition, onOutside: close })

  /**
   * 浮层挂到哪。
   * ⚠ 在 DtModal 里必须挂进弹窗面板：挂 body 的话浮层是面板的**兄弟节点**，
   * 一来焦点跑出弹窗的焦点陷阱（再按 Tab 直接离开弹窗），二来面板挂着
   * `aria-modal="true"`，读屏会忽略面板之外的一切，整个选项列表对读屏不存在。
   * 面板没有 transform / filter，fixed 定位仍相对视口，也不会被 overflow 裁掉。
   */
  function resolveHost(): string | HTMLElement {
    return root.value?.closest<HTMLElement>('.dt-modal__panel') ?? 'body'
  }

  function open(): void {
    if (isOpen.value) return
    host.value = resolveHost()
    isOpen.value = true
    query.value = ''
    activeIndex.value = options.initialIndex()
    // 浮层 teleport 出去了，不在 root 子树里——点它不算点外面
    tracking.start(() => [root.value, menu.value?.el ?? null])
    reposition()
    void nextTick(() => {
      reposition()
      if (options.hasSearch()) menu.value?.focusSearch()
      menu.value?.scrollActiveIntoView()
    })
  }

  const state = { isOpen, query, activeIndex, style, host, root, menu }
  return { ...state, open, close, reposition }
}
