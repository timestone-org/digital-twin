/**
 * @fileoverview 渲染循环：每帧夹一次时长交给宿主，再画一帧；外加跟着宿主元素尺寸重设视口。
 *
 * ⚠ 帧钟夹过的时长不能换成 rAF 的原始时刻：切走标签页再回来那一帧有几十秒，
 * 直接算下去的话，一帧就能把整条漫游轨迹走完、把动画跳过一大截。
 */
import type * as THREE from 'three'
import { onBeforeUnmount } from 'vue'

import { createFrameClock } from './frameClock'
import { renderScene, resizeScene, type SceneCore } from './sceneCore'

export interface RenderLoopOptions {
  core: () => SceneCore | null
  /** 量尺寸用的宿主元素。 */
  element: () => HTMLElement | null
  /**
   * 挂着 CSS2D / CSS3D 元素的那棵子树；不给就让两个 CSS 渲染器走整个 scene。
   * ⚠ 给它是为了别让它们每帧把整棵模型白走一遍，见 `renderScene`。
   */
  overlayRoot?: () => THREE.Scene | null
  /**
   * 每帧回调，在画之前。
   * @param deltaS 距上一帧多少秒（已夹过上限）
   */
  onFrame: (deltaS: number) => void
}

export interface RenderLoop {
  /** 场景内核装配好之后调一次：量一次尺寸并起循环。 */
  start: () => void
  /** 手动量一次，宿主换了尺寸时用。 */
  measure: () => void
}

/**
 * 装上渲染循环。
 * @param options 场景内核、宿主元素与每帧回调
 */
export function useRenderLoop(options: RenderLoopOptions): RenderLoop {
  const clock = createFrameClock()
  let observer: ResizeObserver | null = null
  let frameHandle = 0

  function measure(): void {
    const core = options.core()
    const element = options.element()
    if (core === null || element === null) return
    resizeScene(core, element.clientWidth, element.clientHeight)
  }

  function tick(now: number): void {
    const core = options.core()
    if (core === null) return
    options.onFrame(clock.tick(now))
    renderScene(core, options.overlayRoot?.() ?? null)
    frameHandle = requestAnimationFrame(tick)
  }

  function start(): void {
    const element = options.element()
    if (element === null) return
    observer = new ResizeObserver(measure)
    observer.observe(element)
    measure()
    clock.reset()
    frameHandle = requestAnimationFrame(tick)
  }

  // ⚠ 早于宿主释放场景那一步跑：Vue 按注册顺序调卸载钩子，而这个组合式函数
  // 在 setup 里先装配。反过来的话最后一帧会画在已 dispose 的场景上
  onBeforeUnmount(() => {
    cancelAnimationFrame(frameHandle)
    observer?.disconnect()
    observer = null
  })

  return { start, measure }
}
