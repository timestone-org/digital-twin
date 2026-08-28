/**
 * @fileoverview 「画布裁到内容」这一手：量出整张图占的那只盒，把画布收成它的大小，
 * 再把全图挪到原点留出一圈留白。节点、标注与连线拐点三样一起挪。
 *
 * ⚠ 这是**画布卫生**，不是「让图变清晰」的手段：`contain` 一档下裁掉空白会让缩放倍率
 * 变大，而倍率大于 1 就是把整张图放大重采样，字与细线反而更糊。要清晰只有让倍率恒等于
 * 1（缩放方式选「原尺寸」，或把模块格子调成画布那么大）。裁的价值是去掉四周白边、
 * 让画布尺寸说得出这张图到底多大。
 * ⚠ 三样坐标必须一起挪：只挪节点的话，连线的拐点与标注留在原地，图就散了，而每一件
 * 单看都还在自己该在的地方。
 * ⚠ 一手势一步撤销：本文件只产整份新配置，落库与撤销栈归页面。
 */
import {
  TWIN_2D_MAX_CANVAS_SIZE,
  TWIN_2D_MIN_CANVAS_SIZE,
  clamp,
} from '@dt/twin2d'
import type { Pt, Twin2dConfig } from '@dt/twin2d'

import { markSnapBox, nodeSnapBox, pointsBox } from './entityBoxes'
import type { Twin2dSnapBox } from './snapping'
import { twin2dMergedEdgeStyles, twin2dMergedNodeStyles } from './styleOps'
import { edgePolyline } from './waypointOps'

/** 裁完之后四周留多少（设计像素）。 */
export const TWIN_2D_FIT_MARGIN = 20

/** 这张图占的那只盒，以及裁到内容之后画布该多大。 */
export interface Twin2dContentFit {
  /** 全图的外接盒（设计坐标）。 */
  content: Twin2dSnapBox
  /** 裁完的画布尺寸。 */
  canvas: { width: number; height: number }
  /** 全图要挪的位移。 */
  shift: Pt
  /** 已经裁好了，点了也不会变。 */
  exact: boolean
}

/**
 * 量一张图占的那只盒；一个节点、一条标注、一条线都没有时给 null。
 * ⚠ 样式库在这里自己并：口径与调色板、画布层同一支（`twin2dMergedNodeStyles`），
 * 只喂文档里那几份的话，用预置样式的节点量不出盒、于是裁的时候被留在画布外面。
 * ⚠ 连线按它的**完整折线**取外接盒：只算两端的话，绕出去的那一段会被裁在画布外面，
 * 而两端明明都在画布里。
 * @param config 当前配置
 */
export function twin2dContentBox(config: Twin2dConfig): Twin2dSnapBox | null {
  const nodeStyles = twin2dMergedNodeStyles(config.styles)
  const edgeStyles = twin2dMergedEdgeStyles(config.edgeStyles)
  const byId = new Map(nodeStyles.map((style) => [style.id, style]))
  const boxes: Twin2dSnapBox[] = []
  for (const node of config.nodes) {
    const style = byId.get(node.styleId)
    // 样式悬空的节点画不出来，也就不占地方：与节点层「整个不画」同口径
    if (style !== undefined) boxes.push(nodeSnapBox(node, style))
  }
  for (const mark of config.marks) boxes.push(markSnapBox(mark))
  for (const edge of config.edges) {
    const line = edgePolyline(edge, config.nodes, nodeStyles, edgeStyles)
    const box = pointsBox(line)
    if (box !== null) boxes.push(box)
  }
  return unionOf(boxes)
}

/**
 * 这张图现在该怎么裁；一件都没画时 null。
 * @param config 当前配置
 */
export function twin2dContentFitOf(
  config: Twin2dConfig,
): Twin2dContentFit | null {
  const box = twin2dContentBox(config)
  return box === null ? null : twin2dContentFit(box, config.canvas)
}

/**
 * 裁到内容之后画布该多大、全图该挪多少。
 * ⚠ 边长仍要夹进画布的上下限：内容比下限还小时交出夹过的值，此时四周会多留一些白，
 * 而不是产出一个画不出来的画布。
 * @param content 全图的外接盒
 * @param canvas 当前画布尺寸
 * @param margin 四周留白
 */
export function twin2dContentFit(
  content: Twin2dSnapBox,
  canvas: { width: number; height: number },
  margin: number = TWIN_2D_FIT_MARGIN,
): Twin2dContentFit {
  const pad = Math.max(0, margin)
  const size = {
    width: side(content.w + pad * 2),
    height: side(content.h + pad * 2),
  }
  const shift = { x: pad - content.x, y: pad - content.y }
  return {
    content,
    canvas: size,
    shift,
    exact:
      size.width === canvas.width &&
      size.height === canvas.height &&
      shift.x === 0 &&
      shift.y === 0,
  }
}

/**
 * 把整份配置裁到内容：换画布尺寸，并把三样坐标一起挪。
 * ⚠ 位移为零且尺寸没变时原样返回入参那份配置：抛一份没改动的出去会往撤销栈里塞一格
 * 空步，撤销键从此要多按一次。
 * @param config 当前配置
 * @param fit 量好的结果
 */
export function twin2dFitToContent(
  config: Twin2dConfig,
  fit: Twin2dContentFit,
): Twin2dConfig {
  if (fit.exact) return config
  const { x, y } = fit.shift
  return {
    ...config,
    canvas: { ...config.canvas, ...fit.canvas },
    nodes: config.nodes.map((node) => ({
      ...node,
      x: node.x + x,
      y: node.y + y,
    })),
    marks: config.marks.map((mark) =>
      mark.kind === 'line'
        ? {
            ...mark,
            x: mark.x + x,
            y: mark.y + y,
            x2: mark.x2 + x,
            y2: mark.y2 + y,
          }
        : { ...mark, x: mark.x + x, y: mark.y + y },
    ),
    edges: config.edges.map((edge) => ({
      ...edge,
      waypoints: edge.waypoints.map((at) => ({ x: at.x + x, y: at.y + y })),
    })),
  }
}

/**
 * 一批盒的外接盒；一只都没有时 null。
 * @param boxes 这一批盒
 */
function unionOf(boxes: readonly Twin2dSnapBox[]): Twin2dSnapBox | null {
  const first = boxes[0]
  if (first === undefined) return null
  let left = first.x
  let top = first.y
  let right = first.x + first.w
  let bottom = first.y + first.h
  for (const box of boxes) {
    left = Math.min(left, box.x)
    top = Math.min(top, box.y)
    right = Math.max(right, box.x + box.w)
    bottom = Math.max(bottom, box.y + box.h)
  }
  return { x: left, y: top, w: right - left, h: bottom - top }
}

/**
 * 一条边长：取整并夹进画布上下限。
 * @param value 原始值
 */
function side(value: number): number {
  return clamp(
    Math.round(value),
    TWIN_2D_MIN_CANVAS_SIZE,
    TWIN_2D_MAX_CANVAS_SIZE,
  )
}
