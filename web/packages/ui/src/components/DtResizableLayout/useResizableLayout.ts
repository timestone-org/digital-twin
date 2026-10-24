/** @fileoverview 将布局尺寸、指针调整与本地偏好连接到组件生命周期。 */
import { onUnmounted, ref, watch } from 'vue'
import { createLayoutDrag } from './layoutDrag'
import {
  initialShares,
  readShares,
  resizePair,
  writeShares,
} from './layoutSizes'
import { useLayoutGeometry, type LayoutOptions } from './useLayoutGeometry'

export function useResizableLayout(options: LayoutOptions) {
  const shares = ref(initialShares(options.panes))
  const geometry = useLayoutGeometry(options, shares, () => drag.stop())
  const storageKey = (): string | undefined =>
    layoutStorageKey(options, geometry.direction.value)
  const commit = (): void =>
    writeShares(options.panes, shares.value, storageKey())
  const drag = createLayoutDrag(
    () => ({
      direction: geometry.direction.value,
      ...geometry.allocation.value,
    }),
    (sizes) => {
      shares.value = sizes
    },
    commit,
  )
  function nudge(index: number, delta: number): void {
    const { sizes, minimums } = geometry.allocation.value
    shares.value = resizePair(
      sizes,
      minimums,
      index,
      (sizes[index] ?? 0) + delta,
    )
    commit()
  }
  function reset(): void {
    drag.stop()
    shares.value = initialShares(options.panes)
    commit()
  }
  watch(
    () => JSON.stringify([options.panes, storageKey()]),
    () => {
      drag.stop()
      shares.value = readShares(options.panes, storageKey())
    },
    { immediate: true },
  )
  onUnmounted(drag.stop)
  return {
    ...geometry,
    isResizing: drag.isResizing,
    startDrag: drag.start,
    nudge,
    reset,
  }
}

function layoutStorageKey(
  options: LayoutOptions,
  direction: string,
): string | undefined {
  if (!options.storageKey) return undefined
  // ⚠ 隐藏区块后的布局单独存档，恢复完整布局时才不会丢掉隐藏区域的比例。
  const visible = options.panes
    .map((pane) => encodeURIComponent(pane.id))
    .join(',')
  return `${options.storageKey}.${direction}.${visible}`
}
