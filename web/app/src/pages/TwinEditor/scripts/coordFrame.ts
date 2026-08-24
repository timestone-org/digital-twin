/**
 * @fileoverview 坐标基准在右栏的那点文案：两档选项，与「0 在哪」的说法。
 * 换算本身在 `@dt/twin-config` 的 coordFrame，这里一行算术都不做。
 */
import type { DtSegmentedOption } from '@dt/contracts'
import type { TwinCoordFrame, Vec3 } from '@dt/twin-config'

/**
 * 坐标框要知道的两件事：0 落在哪，以及这套基准怎么称呼。
 * ⚠ 原点由视口算（`center` 那一档要模型的世界包围盒），不是从配置里读得出来的。
 */
export interface TwinFrameView {
  mode: TwinCoordFrame
  /** 基准原点，世界坐标。 */
  origin: Vec3
}

export const COORD_FRAME_OPTIONS: readonly DtSegmentedOption[] = [
  { value: 'model', label: '模型原点' },
  { value: 'center', label: '模型中心' },
]

/** 坐标框下那行提示里「0 在哪」的说法。 */
export function coordFrameZeroLabel(mode: TwinCoordFrame): string {
  return mode === 'center' ? '0 在模型中心' : '0 在模型原点'
}

/** 一个轴的读数文案：最多两位小数，末尾的 0 不留。 */
export function coordAxisText(value: number): string {
  return Number.isFinite(value) ? String(Number(value.toFixed(2))) : '—'
}

/** 三元组的读数文案，「x / y / z」。 */
export function coordText(value: Vec3): string {
  return value.map(coordAxisText).join(' / ')
}
