/**
 * @fileoverview 大屏几何：节点坐标是设计坐标系里的**绝对像素**，整块舞台靠一次
 * `transform: scale` 做等比 letterbox（docs/DASHBOARD_DESIGN.md §7）。
 * 栅格退成编辑器的吸附辅助、不再参与定位，所以节点矩形是恒等映射。
 */
import type { ContentInset } from '@dt/modules'

/** 设计坐标系缺省宽（px）。 */
export const DEFAULT_DESIGN_WIDTH = 1920

/** 设计坐标系缺省高（px）。 */
export const DEFAULT_DESIGN_HEIGHT = 1080

/**
 * 1:1 钉位容差。
 * ⚠ 缩放落在 1 附近就钉成 1：1080p 墙屏上窗口边框差几像素会让整屏被重采样，
 * 小字随之发糊，而那几像素本身肉眼看不出来。
 */
export const SCALE_SNAP_TOLERANCE = 0.02

/** 一层坐标系的尺寸（px）：顶层是大屏设计尺寸，容器子层是父容器的内容区尺寸。 */
export interface DesignSize {
  width: number
  height: number
}

/** 节点在本层坐标系里的位置与大小（px），字段名同 `DashboardNodePayload`。 */
export interface NodeBox {
  x: number
  y: number
  w: number
  h: number
}

/** 绝对定位用的像素矩形。 */
export interface ModuleRect {
  left: number
  top: number
  width: number
  height: number
}

/** 舞台的等比缩放结果，`offsetX` / `offsetY` 是 letterbox 留白的一半。 */
export interface StageGeometry {
  scale: number
  width: number
  height: number
  offsetX: number
  offsetY: number
}

/** 非有限数一律按 0 处理，免得算出 `NaN` 再当成长度写进 style。 */
function finite(value: number): number {
  return Number.isFinite(value) ? value : 0
}

/** 非正数与非有限数回退到缺省。 */
function positive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback
}

/**
 * 归一一份设计尺寸，脏值回退到 1920×1080。
 * @param width 设计宽（px）
 * @param height 设计高（px）
 */
export function designSize(width: number, height: number): DesignSize {
  return {
    width: positive(width, DEFAULT_DESIGN_WIDTH),
    height: positive(height, DEFAULT_DESIGN_HEIGHT),
  }
}

/**
 * 节点矩形：**恒等映射**，因为坐标本来就是本层的绝对像素。
 * ⚠ 不取整：亚像素在 `scale` 之下是有意义的，四舍五入会让相邻模块之间在缩放后
 * 露出一条缝，而缝的宽度随缩放比例变化、在设计尺寸下完全看不见。
 * @param box 节点的 x/y/w/h
 */
export function moduleRect(box: NodeBox): ModuleRect {
  return {
    left: finite(box.x),
    top: finite(box.y),
    width: Math.max(0, finite(box.w)),
    height: Math.max(0, finite(box.h)),
  }
}

/**
 * 容器子层的设计尺寸 = 容器矩形扣掉内容区内缩。递归就是每一层各算一次。
 * ⚠ 内缩由容器组件自己以 padding 渲染，这里只用来定子层坐标系的边界；
 * 再把它加进子节点坐标就是加了两次，而加两次与漏加一样看不出是谁干的。
 * @param rect 容器自身在本层里的像素矩形
 * @param inset 内容区四边内缩
 */
export function containerGeometry(
  rect: ModuleRect,
  inset: ContentInset,
): DesignSize {
  return {
    width: Math.max(0, rect.width - finite(inset.left) - finite(inset.right)),
    height: Math.max(0, rect.height - finite(inset.top) - finite(inset.bottom)),
  }
}

/**
 * 舞台缩放：等比缩到视口里，四周留白即 letterbox。
 * @param viewport 视口尺寸（px）
 * @param design 设计坐标系尺寸（px）
 */
export function computeStageGeometry(
  viewport: DesignSize,
  design: DesignSize,
): StageGeometry {
  const { width: designWidth, height: designHeight } = designSize(
    design.width,
    design.height,
  )
  const viewportWidth = Math.max(0, finite(viewport.width))
  const viewportHeight = Math.max(0, finite(viewport.height))
  if (viewportWidth === 0 || viewportHeight === 0) {
    return {
      scale: 1,
      width: designWidth,
      height: designHeight,
      offsetX: 0,
      offsetY: 0,
    }
  }
  const scale = snapToOne(
    Math.min(viewportWidth / designWidth, viewportHeight / designHeight),
  )
  const width = designWidth * scale
  const height = designHeight * scale
  return {
    scale,
    width,
    height,
    offsetX: (viewportWidth - width) / 2,
    offsetY: (viewportHeight - height) / 2,
  }
}

/** 落在 1 附近的缩放钉成 1。 */
function snapToOne(scale: number): number {
  return Math.abs(scale - 1) <= SCALE_SNAP_TOLERANCE ? 1 : scale
}
