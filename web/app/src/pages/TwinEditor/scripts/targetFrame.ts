/**
 * @fileoverview 大屏格子的比例换算：编辑视口按它留边，画中画预览按它定大小。
 */
import type { CSSProperties } from 'vue'

/** 这块孪生在大屏上占多大（设计像素）。 */
export interface TwinTargetSize {
  width: number
  height: number
}

/** 画中画的外框：落地像素尺寸，加上把设计像素缩到这么大的倍率。 */
export interface TwinPreviewBox {
  width: number
  height: number
  /** 设计像素 → 画中画像素的倍率。 */
  scale: number
}

/**
 * 尺寸能不能拿来算比例。
 * @param size 目标尺寸；0 与负数一律当没给
 */
export function isUsableTargetSize(
  size: TwinTargetSize | undefined,
): size is TwinTargetSize {
  return size !== undefined && size.width > 0 && size.height > 0
}

/**
 * 目标格子的宽高，交给样式表算比例框。
 *
 * ⚠ 出的是两个自定义属性而不是算好的宽高：`min()` 与容器查询单位这类现代
 * 语法只能写在样式表里，内联样式一旦被解析器丢掉，框就悄悄退回铺满。
 * ⚠ 拿到它的元素必须同时挂上比例框那个类名，两者缺一个都是「铺满」。
 * @param size 目标尺寸；不合法时返回 undefined = 不锁比例
 */
export function targetFrameVars(
  size: TwinTargetSize | undefined,
): CSSProperties | undefined {
  if (!isUsableTargetSize(size)) return undefined
  return {
    '--twin-frame-w': `${size.width}`,
    '--twin-frame-h': `${size.height}`,
  }
}

/**
 * 把目标格子等比缩进一个上限框里。
 * ⚠ 格子比上限框还小时倍率大于 1，照样放大：画中画守的是**比例**，
 * 缩到 1:1 以下反而会让小格子在角落里小得看不清。
 * @param size 目标尺寸
 * @param limit 画中画能占的最大宽高
 */
export function previewBoxOf(
  size: TwinTargetSize,
  limit: TwinTargetSize,
): TwinPreviewBox {
  const scale = Math.min(limit.width / size.width, limit.height / size.height)
  return {
    width: Math.round(size.width * scale),
    height: Math.round(size.height * scale),
    scale,
  }
}
