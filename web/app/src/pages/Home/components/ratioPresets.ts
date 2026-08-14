/**
 * @fileoverview 新建大屏的设计尺寸预设与夹取。
 *
 * 设计坐标系是一套固定像素基准，运行时整块 scale 到实际屏幕，所以这里选的是
 * 「按哪种屏画」而不是窗口尺寸——同一张屏在 4K 与 1080P 上都能铺满。
 */
import type { DtSelectOption } from '@dt/contracts'

export interface RatioPreset {
  id: string
  label: string
  width: number
  height: number
}

/** 宽高不落在任何预设上时的 id。 */
export const CUSTOM_PRESET_ID = 'custom'

export const DEFAULT_DESIGN_WIDTH = 1920
export const DEFAULT_DESIGN_HEIGHT = 1080

/** 设计尺寸下界（像素）。 */
const MIN_DESIGN_PX = 320
/** 设计尺寸上界（像素），按 8K 宽取。 */
const MAX_DESIGN_PX = 7680

export const RATIO_PRESETS: readonly RatioPreset[] = [
  { id: 'fhd', label: '1080P 横屏 · 16:9', width: 1920, height: 1080 },
  { id: 'qhd', label: '2K 横屏 · 16:9', width: 2560, height: 1440 },
  { id: 'uhd', label: '4K 横屏 · 16:9', width: 3840, height: 2160 },
  { id: 'hd', label: '720P 横屏 · 16:9', width: 1280, height: 720 },
  { id: 'ultrawide', label: '带鱼屏 · 21:9', width: 2560, height: 1080 },
  { id: 'wide-triple', label: '三联横屏 · 48:9', width: 5760, height: 1080 },
  { id: 'standard', label: '标准屏 · 4:3', width: 1600, height: 1200 },
  { id: 'portrait', label: '竖屏 · 9:16', width: 1080, height: 1920 },
  { id: 'portrait-tall', label: '竖屏 · 3:4', width: 1200, height: 1600 },
]

/** 数字输入框的取值域，与 `clampDesignSize` 同界。 */
export const DESIGN_SIZE_RANGE = {
  min: MIN_DESIGN_PX,
  max: MAX_DESIGN_PX,
  step: 10,
  precision: 0,
} as const

/** 夹到合法设计尺寸；非有限数回落到下界。 */
export function clampDesignSize(value: number): number {
  if (!Number.isFinite(value)) return MIN_DESIGN_PX
  return Math.min(MAX_DESIGN_PX, Math.max(MIN_DESIGN_PX, Math.round(value)))
}

/** 由宽高反查预设 id；没有命中就是自定义。 */
export function presetIdFor(width: number, height: number): string {
  const hit = RATIO_PRESETS.find(
    (preset) => preset.width === width && preset.height === height,
  )
  return hit === undefined ? CUSTOM_PRESET_ID : hit.id
}

/**
 * 预设下拉的选项。
 * ⚠ 末尾恒挂一项「自定义」：不挂的话，手改宽高后下拉会因为选中值不在选项里
 * 而退回占位文案，看着像「尺寸没设」。
 */
export const RATIO_PRESET_OPTIONS: readonly DtSelectOption[] = [
  ...RATIO_PRESETS.map((preset) => ({ value: preset.id, label: preset.label })),
  { value: CUSTOM_PRESET_ID, label: '自定义尺寸' },
]

/** 按 id 取预设；`custom` 与未知 id 都返回 undefined（调用方据此不动宽高）。 */
export function findPreset(id: string): RatioPreset | undefined {
  return RATIO_PRESETS.find((preset) => preset.id === id)
}

/** 辗转相除求最大公约数，`aspectLabel` 用它把宽高约到最简。 */
function greatestCommonDivisor(a: number, b: number): number {
  return b === 0 ? a : greatestCommonDivisor(b, a % b)
}

/**
 * 把设计尺寸约成比例文本，如 `1920×1080` → `16:9`。
 * ⚠ 非正数给「—」而不是算出 `NaN:NaN`：卡片角标上一个 NaN 比没有角标更难查。
 * @param width 设计宽（像素）
 * @param height 设计高（像素）
 */
export function aspectLabel(width: number, height: number): string {
  if (!Number.isFinite(width) || !Number.isFinite(height)) return '—'
  if (width <= 0 || height <= 0) return '—'
  const divisor = greatestCommonDivisor(width, height)
  return `${width / divisor}:${height / divisor}`
}
