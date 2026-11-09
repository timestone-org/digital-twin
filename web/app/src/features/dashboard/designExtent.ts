/**
 * @fileoverview 大屏设计宽高的取值域，与服务端 `MIN/MAX_DESIGN_EXTENT_PX` 同一份口径。
 * 越界的值存不进去（422），编辑侧在落笔时就夹回来。
 */
import type { DtNumberRange } from '@dt/contracts'

/** 设计宽高的下界（px）。 */
export const DESIGN_EXTENT_MIN = 320

/** 设计宽高的上界（px）。 */
export const DESIGN_EXTENT_MAX = 20_000

/** 数字框用的取值域。 */
export const DESIGN_EXTENT_RANGE: DtNumberRange = {
  min: DESIGN_EXTENT_MIN,
  max: DESIGN_EXTENT_MAX,
}

/**
 * 夹回服务端收得下的设计宽高。
 * @param value 要落笔的宽或高
 */
export function clampDesignExtent(value: number): number {
  return Math.min(DESIGN_EXTENT_MAX, Math.max(DESIGN_EXTENT_MIN, value))
}
