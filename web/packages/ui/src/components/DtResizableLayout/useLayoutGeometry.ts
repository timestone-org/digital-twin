/** @fileoverview 布局宿主尺寸观察和栅格尺寸派生。 */
import {
  computed,
  onMounted,
  onUnmounted,
  ref,
  type CSSProperties,
  type Ref,
} from 'vue'
import {
  allocateSizes,
  HANDLE_SIZE_PX,
  pairLimits,
  type LayoutDirection,
  type ResizablePane,
} from './layoutSizes'

export interface LayoutOptions {
  panes: readonly ResizablePane[]
  direction: LayoutDirection
  stackAt: number
  storageKey?: string | undefined
}

function useMeasuredSize(onResize: () => void) {
  const host = ref<HTMLElement | null>(null)
  const width = ref(1024)
  const height = ref(600)
  let observer: ResizeObserver | null = null
  function measure(): void {
    const rect = host.value?.getBoundingClientRect()
    if (!rect || rect.width <= 0 || rect.height <= 0) return
    if (rect.width !== width.value || rect.height !== height.value) onResize()
    width.value = rect.width
    height.value = rect.height
  }
  onMounted(() => {
    measure()
    if (typeof ResizeObserver !== 'undefined' && host.value) {
      observer = new ResizeObserver(measure)
      observer.observe(host.value)
    }
    window.addEventListener('resize', measure)
  })
  onUnmounted(() => {
    observer?.disconnect()
    window.removeEventListener('resize', measure)
  })
  return { host, width, height }
}

export function useLayoutGeometry(
  options: LayoutOptions,
  shares: Ref<number[]>,
  onResize: () => void,
) {
  const measured = useMeasuredSize(onResize)
  const direction = computed<LayoutDirection>(() =>
    options.direction === 'horizontal' &&
    options.stackAt > 0 &&
    measured.width.value < options.stackAt
      ? 'vertical'
      : options.direction,
  )
  const extent = computed(() =>
    direction.value === 'horizontal'
      ? measured.width.value
      : measured.height.value,
  )
  const handleSize = computed(() =>
    options.panes.length < 2
      ? 0
      : Math.min(HANDLE_SIZE_PX, extent.value / (options.panes.length * 2 - 1)),
  )
  const allocation = computed(() =>
    allocateSizes(
      shares.value,
      options.panes,
      extent.value - Math.max(0, options.panes.length - 1) * handleSize.value,
    ),
  )
  const style = computed(() =>
    gridStyle(allocation.value.sizes, handleSize.value, direction.value),
  )
  return {
    host: measured.host,
    direction,
    allocation,
    style,
    sizes: computed(() => allocation.value.sizes),
    limits: (index: number) =>
      pairLimits(allocation.value.sizes, allocation.value.minimums, index),
  }
}

function gridStyle(
  sizes: readonly number[],
  handleSize: number,
  direction: LayoutDirection,
): CSSProperties {
  const tracks =
    sizes.map((size) => `${size}px`).join(` ${handleSize}px `) ||
    'minmax(0, 1fr)'
  return direction === 'horizontal'
    ? { gridTemplateColumns: tracks, gridTemplateRows: 'minmax(0, 1fr)' }
    : { gridTemplateRows: tracks, gridTemplateColumns: 'minmax(0, 1fr)' }
}
