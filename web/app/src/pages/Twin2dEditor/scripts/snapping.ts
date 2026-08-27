/**
 * @fileoverview 画布吸附的纯算术：落点吸网格（拐点、连线端点、标注端点），节点拖动
 * 在网格之外还吸同级节点的边线并交出参考线。
 *
 * ⚠ 吸附是可关的，关了要**真的**一点不吸：留一手「至少吸网格」会让「关掉吸附再对
 * 一两个像素」这件事永远做不成。
 * ⚠ 阈值是**设计**像素。画布层要先按当前倍率换算（`snapThresholdOf`），不换算的话
 * 缩得越小屏幕上的吸附圈越小，缩到四分之一时基本吸不上。
 */
import { TWIN_2D_DEFAULT_GRID, finiteOr } from '@dt/twin2d'
import type { Pt } from '@dt/twin2d'

import { screenToDesignPx } from './viewportOps'

/** 参考线的缺省阈值（屏幕像素）。 */
export const TWIN_2D_SNAP_THRESHOLD = 6

/** 一次吸附看的四样东西。 */
export interface Twin2dSnapOptions {
  /** 总开关，关掉即自由摆放。 */
  enabled: boolean
  /** 网格步长，取 `canvas.grid`（归一化后恒在 2..200）。 */
  grid: number
  /** 吸同级节点的边线；只影响节点拖动，落点那一路不吃它。 */
  guides: boolean
  /** 边线吸附阈值（设计像素）。 */
  threshold: number
}

/** 缺省吸附：开、20 px 网格、开参考线。 */
export const TWIN_2D_DEFAULT_SNAP: Readonly<Twin2dSnapOptions> = Object.freeze({
  enabled: true,
  grid: TWIN_2D_DEFAULT_GRID,
  guides: true,
  threshold: TWIN_2D_SNAP_THRESHOLD,
})

/**
 * 一个待吸附的盒。
 * ⚠ `x/y` 是**左上角**，与 `Twin2dNode` 同源；几何层的 `Box` 以中心为参考，别混
 * 用——混了的表现是节点整体偏半个身位，而它看起来像「吸附点算错了」。
 */
export interface Twin2dSnapBox {
  x: number
  y: number
  w: number
  h: number
}

/**
 * 一条对齐参考线。
 * ⚠ `axis` 说的是「恒定的是哪一根坐标」：`'x'` 是一条**竖**线。
 */
export interface Twin2dGuideLine {
  axis: 'x' | 'y'
  at: number
}

/** 一次盒吸附的结果：新的左上角，加上这一帧要画的参考线。 */
export interface Twin2dSnapResult {
  x: number
  y: number
  guides: readonly Twin2dGuideLine[]
}

/** 一次对齐命中：要挪多少，以及吸在哪根线上。 */
interface AlignHit {
  delta: number
  at: number
}

/**
 * 吸到最近的一格网格线；步长非正即原样返回。
 * @param value 原始坐标
 * @param grid 网格步长
 */
export function snapValue(value: number, grid: number): number {
  const at = finiteOr(value, 0)
  const step = finiteOr(grid, 0)
  if (step <= 0) return at
  return Math.round(at / step) * step
}

/**
 * 落点吸网格：拐点、连线端点与标注端点都走它。
 * @param at 落点（设计坐标）
 * @param options 吸附配置
 */
export function snapPoint(at: Pt, options: Twin2dSnapOptions): Pt {
  if (!options.enabled) return { x: at.x, y: at.y }
  return {
    x: snapValue(at.x, options.grid),
    y: snapValue(at.y, options.grid),
  }
}

/**
 * 屏幕像素阈值 → 当前倍率下的设计像素阈值。
 * @param scale 当前视口倍率
 * @param screenPx 屏幕上想要的吸附圈
 */
export function snapThresholdOf(
  scale: number,
  screenPx: number = TWIN_2D_SNAP_THRESHOLD,
): number {
  return screenToDesignPx(screenPx, scale)
}

/**
 * 这一帧生效的吸附配置：按下 Alt 即整帧不吸，阈值按当前倍率换成设计像素。
 * ⚠ 各层不许自己拼这一份：阈值忘了换算的那一层，缩到四分之一时基本吸不上，
 * 而它与吸得上的那些层看起来一模一样。
 * @param options 这张图的吸附配置（阈值是屏幕像素）
 * @param scale 当前视口倍率
 * @param alt 这一帧按着 Alt
 */
export function snapAtScale(
  options: Twin2dSnapOptions,
  scale: number,
  alt: boolean,
): Twin2dSnapOptions {
  return {
    ...options,
    enabled: options.enabled && !alt,
    threshold: snapThresholdOf(scale, options.threshold),
  }
}

/** 一个盒在某一轴上的三根线：起边、中线、末边。 */
function linesOf(start: number, size: number): readonly number[] {
  return [start, start + size / 2, start + size]
}

/**
 * 同级盒在某一轴上的所有可吸线。
 * @param boxes 同级盒
 * @param axis 取哪一轴
 */
function peerLines(boxes: readonly Twin2dSnapBox[], axis: 'x' | 'y'): number[] {
  const lines: number[] = []
  for (const box of boxes) {
    const start = axis === 'x' ? box.x : box.y
    const size = axis === 'x' ? box.w : box.h
    lines.push(...linesOf(start, size))
  }
  return lines
}

/**
 * 阈值之内最近的一次对齐；一条都够不着时 null。
 * @param own 自己的三根线
 * @param peers 同级的可吸线
 * @param threshold 阈值（设计像素）
 */
function bestAlign(
  own: readonly number[],
  peers: readonly number[],
  threshold: number,
): AlignHit | null {
  let best: AlignHit | null = null
  for (const line of own) {
    for (const peer of peers) {
      const delta = peer - line
      if (Math.abs(delta) > threshold) continue
      if (best === null || Math.abs(delta) < Math.abs(best.delta)) {
        best = { delta, at: peer }
      }
    }
  }
  return best
}

/**
 * 单轴吸附：先吸网格，参考线命中就**压过**网格。
 * ⚠ 两者都吸时以对齐为准，否则线永远差那么一两个像素，而那正是用户想对齐的原因。
 * @param start 这一轴上的起边
 * @param size 这一轴上的尺寸
 * @param peers 同级的可吸线
 * @param options 吸附配置
 */
function snapAxis(
  start: number,
  size: number,
  peers: readonly number[],
  options: Twin2dSnapOptions,
): { value: number; at: number | null } {
  const grid = snapValue(start, options.grid)
  if (!options.guides) return { value: grid, at: null }
  const hit = bestAlign(linesOf(start, size), peers, options.threshold)
  if (hit === null) return { value: grid, at: null }
  return { value: start + hit.delta, at: hit.at }
}

/**
 * 节点拖动的吸附：网格 + 同级边线。
 * ⚠ `peers` 里不许含正在拖的那几个节点，否则它会吸住自己——表现是「怎么拖都不动」。
 * ⚠ 多选拖动只吸主选中那一个，再把 `x - box.x` 这个差值原样加到其余节点上；逐个各
 * 吸各的会让一批节点在拖动中散开。
 * @param box 拖到当前位置的盒（左上角参考）
 * @param peers 同级节点的盒
 * @param options 吸附配置
 */
export function snapNodeBox(
  box: Twin2dSnapBox,
  peers: readonly Twin2dSnapBox[],
  options: Twin2dSnapOptions,
): Twin2dSnapResult {
  if (!options.enabled) return { x: box.x, y: box.y, guides: [] }
  const x = snapAxis(box.x, box.w, peerLines(peers, 'x'), options)
  const y = snapAxis(box.y, box.h, peerLines(peers, 'y'), options)
  const guides: Twin2dGuideLine[] = []
  if (x.at !== null) guides.push({ axis: 'x', at: x.at })
  if (y.at !== null) guides.push({ axis: 'y', at: y.at })
  return { x: x.value, y: y.value, guides }
}
