/**
 * @fileoverview DtProgress 的取值归一与环形几何。
 * 抽出来是为了能单测：NaN / 0 上限这类输入在挂载测试里只看得到「画歪了」。
 */
import type { DtSize } from '@dt/contracts'

const FALLBACK_MAX = 100

/** 环的直径与描边宽度，按档位。两者一起决定半径，改一个必须看另一个。 */
const RING_DIAMETER_PX: Record<DtSize, number> = { sm: 36, md: 52, lg: 72 }
const RING_STROKE_PX: Record<DtSize, number> = { sm: 4, md: 5, lg: 6 }

export interface DtRingGeometry {
  diameter: number
  stroke: number
  radius: number
  circumference: number
}

/**
 * ⚠ 非有限或非正的上限一律回退 100：留着它会产出 `aria-valuemax="NaN"`
 * 与 `width: NaN%`，两者都不报错，只是进度条整条不画。
 * @param max 调用方给的上限
 */
export function safeMax(max: number): number {
  return Number.isFinite(max) && max > 0 ? max : FALLBACK_MAX
}

/**
 * 当前值夹进 [0, max]；非有限值当 0。
 * @param value 当前进度
 * @param max 已归一的上限
 */
export function clampProgress(value: number, max: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(Math.max(value, 0), max)
}

/**
 * 完成比例，落在 [0, 1]。
 * @param value 当前进度
 * @param max 调用方给的上限，内部会先归一
 */
export function progressFraction(value: number, max: number): number {
  const upper = safeMax(max)
  return clampProgress(value, upper) / upper
}

/**
 * 环形进度的几何：描边画在半径上，所以半径要扣掉半个线宽才不被视框裁掉。
 * @param size 档位
 */
export function ringGeometry(size: DtSize): DtRingGeometry {
  const diameter = RING_DIAMETER_PX[size]
  const stroke = RING_STROKE_PX[size]
  const radius = (diameter - stroke) / 2
  return { diameter, stroke, radius, circumference: 2 * Math.PI * radius }
}
