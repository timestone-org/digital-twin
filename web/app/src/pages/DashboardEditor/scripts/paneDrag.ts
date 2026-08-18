/**
 * @fileoverview 改宽用到的两个 DOM 接线：指针拖拽与容器尺寸观察。
 * 两者都往 window / ResizeObserver 上挂东西，卸载必须摘干净——编辑器一开就是几天。
 */
import { onMounted, onUnmounted, ref } from 'vue'
import type { Ref } from 'vue'

import type { PaneSide } from './paneWidths'

/** 一次拖拽的接线。返回的解绑函数在拖完与卸载时都要调。 */
export interface DragBinding {
  isResizing: Ref<boolean>
  start: (side: PaneSide, event: PointerEvent) => void
  stop: () => void
}

/**
 * 指针拖拽：按下记起点，移动按位移改宽，松手落档。
 * ⚠ 监听挂在 window 上而不是分隔条上——拖快了指针会甩出那 12px，
 * 挂在条上会中途丢事件、宽度停在半路。卸载时必须摘掉。
 * @param read 这一侧当前宽度
 * @param apply 把这一侧改成某个宽度（内部自己 clamp）
 * @param commit 松手后落档
 */
export function createDrag(
  read: (side: PaneSide) => number,
  apply: (side: PaneSide, width: number) => void,
  commit: () => void,
): DragBinding {
  const isResizing = ref(false)
  let unbind: (() => void) | null = null

  function stop(): void {
    unbind?.()
    unbind = null
    isResizing.value = false
  }

  function start(side: PaneSide, event: PointerEvent): void {
    event.preventDefault()
    stop()
    const startX = event.clientX
    const startWidth = read(side)
    isResizing.value = true

    const onMove = (moved: PointerEvent): void => {
      // 右栏在容器右侧，指针右移是把它**拉窄**，故取反
      const delta = moved.clientX - startX
      apply(side, startWidth + (side === 'left' ? delta : -delta))
    }
    const onUp = (): void => {
      stop()
      commit()
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    unbind = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }

  return { isResizing, start, stop }
}

/**
 * 窗口一缩，存档里的宽度可能已经超出取值域、把画布挤到没有，故要重夹一次。
 * ⚠ 卸载必须断开：漏一个观察器就一直在那儿测量。
 * @param host 要观察的容器
 * @param onResize 尺寸变化时重夹
 */
export function observeResize(
  host: Ref<HTMLElement | null>,
  onResize: () => void,
): void {
  let observer: ResizeObserver | null = null
  onMounted(() => {
    onResize()
    const element = host.value
    if (element === null || typeof ResizeObserver === 'undefined') return
    observer = new ResizeObserver(onResize)
    observer.observe(element)
  })
  onUnmounted(() => {
    observer?.disconnect()
    observer = null
  })
}
