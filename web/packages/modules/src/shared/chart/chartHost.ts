/**
 * @fileoverview 图表宿主的两件事：按舞台缩放算位图分辨率、在宿主上建实例。
 * 生命周期接线在 `useEChart.ts`，这里只放不碰 Vue 的纯函数。
 */
import { createChart, type ChartHandle } from './echarts'

// 缩放比偏出这一档才值得 dispose 重建：编辑器逐格缩放时不至于每一步都重建
const DPR_REBUILD_RATIO = 0.25

/**
 * 画布该用的位图分辨率倍率 = 屏幕像素比 × 宿主在舞台上的累积缩放比。
 * 缩放比就地量：`getBoundingClientRect().width` 含祖先 transform，`offsetWidth`
 * 是未变换的布局宽，两者一比就是大屏舞台那层 `scale()`。
 * ⚠ 大屏把整个节点树套在 `scale()` 上，只按屏幕像素比建图会让 1920 设计屏铺到
 * 3840 墙屏时位图只有一半分辨率；而 ResizeObserver 量的是 border-box、与祖先
 * transform 无关，所以这个糊没有自愈路径。
 * ⚠ 元素还没布局时布局宽是 0，除下去是 Infinity，这一档只按屏幕像素比算。
 * @param host 图表挂载点
 */
export function chartDprOf(host: HTMLElement): number {
  const layoutWidth = host.offsetWidth
  if (layoutWidth <= 0) return window.devicePixelRatio
  return (
    (window.devicePixelRatio * host.getBoundingClientRect().width) / layoutWidth
  )
}

/**
 * 舞台缩放比偏到该连实例一起重建的地步了没有。
 * ⚠ 只能重建：echarts 的位图分辨率只在 init 时读，改这个数对活着的实例没有效果。
 * @param host 图表挂载点
 * @param builtDpr 建这个实例时用的倍率
 */
export function dprDrifted(host: HTMLElement, builtDpr: number): boolean {
  return Math.abs(chartDprOf(host) - builtDpr) > builtDpr * DPR_REBUILD_RATIO
}

/**
 * 建实例；拉 chunk 失败时给 `null`，由调用方记下容器、下一帧重试。
 * @param el 承载画布的元素
 * @param dpr 位图分辨率倍率
 */
export async function tryCreate(
  el: HTMLElement,
  dpr: number,
): Promise<ChartHandle | null> {
  try {
    return await createChart(el, { devicePixelRatio: dpr })
  } catch {
    return null
  }
}
