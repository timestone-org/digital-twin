/**
 * @fileoverview 锚定浮层的开合、挂载点与定位状态，供 Popover / DropdownMenu / Tooltip 共用。
 * 抽出来是因为这几件事必须成套做对：teleport 出去、跟着滚动重算、点外面收起、卸载摘监听。
 */
import { nextTick, ref } from 'vue'
import type { Ref } from 'vue'
import { measureAnchored } from './placement'
import type { DtOverlayAlign, DtOverlaySide } from './placement'
import { useOverlayTracking } from './useOverlayTracking'

export interface AnchoredOverlayOptions {
  /** ⚠ 由组件自己声明并绑到模板上：模板 ref 只认组件 setup 作用域里的顶层绑定。 */
  trigger: Ref<HTMLElement | null>
  panel: Ref<HTMLElement | null>
  side: () => DtOverlaySide
  align: () => DtOverlayAlign
  /**
   * 点浮层与触发器之外时怎么办。
   * ⚠ 不给缺省的「直接收起」：受控的宿主那样会绕过父组件那条回写，父组件仍以为
   * 开着，之后再点触发器就切不动了。每个宿主必须自己表态走哪条关闭路径。
   */
  onOutside: () => void
}

export interface AnchoredOverlay {
  isOpen: Ref<boolean>
  /** teleport 目标。 */
  host: Ref<string | HTMLElement>
  style: Ref<Record<string, string>>
  /** 实际方向，可能与首选的相反。 */
  side: Ref<DtOverlaySide>
  arrowOffset: Ref<number>
  open: () => void
  close: () => void
  reposition: () => void
}

export function useAnchoredOverlay(
  options: AnchoredOverlayOptions,
): AnchoredOverlay {
  const { trigger, panel } = options
  const isOpen = ref(false)
  const host = ref<string | HTMLElement>('body')
  const style = ref<Record<string, string>>({})
  const side = ref<DtOverlaySide>(options.side())
  const arrowOffset = ref(0)

  function reposition(): void {
    if (!isOpen.value) return
    const placed = measureAnchored({
      trigger: trigger.value,
      overlay: panel.value,
      side: options.side(),
      align: options.align(),
    })
    if (placed === null) return
    style.value = placed.style
    side.value = placed.side
    arrowOffset.value = placed.arrowOffset
  }

  function close(): void {
    if (!isOpen.value) return
    isOpen.value = false
    tracking.stop()
  }

  const tracking = useOverlayTracking({
    reposition,
    onOutside: () => {
      options.onOutside()
    },
  })

  /**
   * ⚠ 在 DtModal 里必须挂进弹窗面板：挂 body 的话浮层是面板的**兄弟节点**，
   * 焦点会跑出弹窗的焦点陷阱，而面板挂着 `aria-modal="true"`，读屏会忽略面板
   * 之外的一切——整个浮层对读屏等于不存在。
   */
  function resolveHost(): string | HTMLElement {
    return trigger.value?.closest<HTMLElement>('.dt-modal__panel') ?? 'body'
  }

  function open(): void {
    if (isOpen.value) return
    host.value = resolveHost()
    isOpen.value = true
    // 浮层 teleport 出去了，不在触发器子树里——点它不算点外面
    tracking.start(() => [trigger.value, panel.value])
    reposition()
    // 首帧还量不到浮层尺寸，量到之后再校正一次方向与箭头
    void nextTick(reposition)
  }

  return { isOpen, host, style, side, arrowOffset, open, close, reposition }
}
