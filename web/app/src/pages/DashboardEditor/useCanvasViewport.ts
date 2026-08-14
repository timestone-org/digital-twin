/**
 * @fileoverview 画布视口：适应窗口倍率、固定倍率下的滚动、⌘滚轮以指针为锚缩放、
 * 空格按住或中键拖拽平移，以及把某个矩形滚进视口中央。这里只持有运行态。
 * ⚠ ResizeObserver 与 window 监听都在卸载时收掉：大屏一开就是几天，漏一次就累积一份。
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'

import { computeStageGeometry, type DesignSize } from '@dt/runtime'

import { clampZoom } from '@/features/dashboard/canvasZoom'
import {
  centerViewport,
  mountViewport,
  pointerDesignOf,
  stageStyleOf,
  startPanning,
  stopViewport,
  wheelZoomAt,
  wrapStyleOf,
  type CanvasViewportOptions,
  type CanvasViewportView,
  type ViewportRuntime,
} from './canvasViewport'

export function useCanvasViewport(
  options: CanvasViewportOptions,
): CanvasViewportView {
  const size = ref<DesignSize>({ width: 0, height: 0 })
  const fitScale = computed(
    () => computeStageGeometry(size.value, options.design()).scale,
  )
  const effScale = computed(() => {
    const zoom = options.zoom()
    return zoom === null ? fitScale.value : clampZoom(zoom)
  })
  const runtime: ViewportRuntime = {
    options,
    viewportRef: ref<HTMLElement | null>(null),
    stageRef: ref<HTMLElement | null>(null),
    size,
    isSpaceHeld: ref(false),
    effScale,
    observer: null,
    keys: null,
    pan: null,
  }

  onMounted(() => mountViewport(runtime))
  onUnmounted(() => stopViewport(runtime))

  return {
    viewportRef: runtime.viewportRef,
    stageRef: runtime.stageRef,
    fitScale,
    effScale,
    stageStyle: computed(() => stageStyleOf(options.design(), effScale.value)),
    wrapStyle: computed(() => wrapStyleOf(options.design(), effScale.value)),
    isPanMode: computed(() => runtime.isSpaceHeld.value),
    pointerDesign: (at) => pointerDesignOf(runtime, at),
    onWheel: (event) => wheelZoomAt(runtime, event),
    startPan: (event) => startPanning(runtime, event),
    centerOn: (rect) => centerViewport(runtime, rect),
    stop: () => stopViewport(runtime),
  }
}
