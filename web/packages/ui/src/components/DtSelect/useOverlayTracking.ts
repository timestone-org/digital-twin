/**
 * @fileoverview 浮层展开期间的窗口跟踪：滚动/缩放重算位置、点外面收起。
 * 抽出来是因为这三条监听必须成对摘干净，散在组件里最容易漏掉其中一条。
 */
import { onBeforeUnmount } from 'vue'

export interface OverlayTracking {
  /** 开始跟踪。`insides` 每次事件重新求值——浮层是 teleport 的，节点会换。 */
  start: (insides: () => readonly (HTMLElement | null)[]) => void
  stop: () => void
}

export interface OverlayTrackingOptions {
  reposition: () => void
  onOutside: () => void
}

export function useOverlayTracking(
  options: OverlayTrackingOptions,
): OverlayTracking {
  let insides: () => readonly (HTMLElement | null)[] = () => []

  function onPointerDown(event: PointerEvent): void {
    const target = event.target
    if (!(target instanceof Node)) return
    const hit = insides().some((node) => node?.contains(target) === true)
    if (!hit) options.onOutside()
  }

  function start(next: () => readonly (HTMLElement | null)[]): void {
    insides = next
    // fixed 定位不跟随祖先滚动，必须逐帧重算
    window.addEventListener('scroll', options.reposition, true)
    window.addEventListener('resize', options.reposition)
    document.addEventListener('pointerdown', onPointerDown)
  }

  function stop(): void {
    // ⚠ capture 传 true 才收得到内层滚动容器的事件；移除时也必须带同一个
    // true，否则移除的是另一个监听器，浮层关掉了监听还留着。
    window.removeEventListener('scroll', options.reposition, true)
    window.removeEventListener('resize', options.reposition)
    document.removeEventListener('pointerdown', onPointerDown)
  }

  // ⚠ 浮层开着时路由跳走也要摘干净，否则监听会留在 window 上持续累积
  onBeforeUnmount(stop)

  return { start, stop }
}
