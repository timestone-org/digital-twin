/**
 * @fileoverview 预置样式的配色。
 * ⚠ 这是全仓唯一一批**不跟随换肤**的取值：本仓没有参考项目那一组 `--chart-*` token，
 * 而预置样式要与它逐像素同色，所以写字面 hex。理由与用户怎么让它跟随换肤，
 * 见 docs/MODULE_TWIN_2D_DESIGN.md §6.1。
 */

/**
 * 能流与温度语义的六个主色，取值逐字取自参考项目的 `--chart-series-1..5` /
 * `--chart-hot` / `--chart-cold`。
 * ⚠ 别改成 `var(--state-success)` 这类语义 token：`--state-success` 是 `#14e144`，
 * 与 `wasteHeat` 不是一个颜色，换过去就直接放弃了「与参考项目逐像素一致」。
 * 用户想让某一格跟随换肤，在样式检查器里把它改成 `var(--accent-primary)` 即可——
 * 那是一个用户动作，不是一次发版。
 */
export const TWIN_2D_PALETTE = {
  wasteHeat: '#62ff8a',
  steam: '#ff5c7a',
  airEnergy: '#ff9b54',
  solar: '#2fe9ff',
  water: '#7bd5ff',
  tempHot: '#ff6b6b',
  tempCold: '#00cefc',
} as const

/** 调色板的键。 */
export type Twin2dPaletteKey = keyof typeof TWIN_2D_PALETTE

/**
 * 同色的 `r, g, b` 三元组文本，配 `rgba(<三元组>, .5)` 用。
 * ⚠ 与上面那张表**必须逐项同色**：两处各写一份就会漂，而漂了只表现为
 * 「同一个颜色的实心与半透明差了一点」，没有任何一处报错。
 * 这一条由 `tests/presets/palette.test.ts` 按 hex → rgb 换算逐项核对。
 */
export const TWIN_2D_PALETTE_RGB = {
  wasteHeat: '98, 255, 138',
  steam: '255, 92, 122',
  airEnergy: '255, 155, 84',
  solar: '47, 233, 255',
  water: '123, 213, 255',
  tempHot: '255, 107, 107',
  tempCold: '0, 206, 252',
} as const

/**
 * 把调色板取值掺进透明底，产出一条 `color-mix()`。
 * ⚠ 只做字符串拼接、绝不解析取值：解析一次就要读 token、就要监听换肤，
 * 本包的依赖里就得加 `tokens`，而那正是 §6.1 要避开的耦合。
 * @param color 任意 CSS 颜色串（调色板取值或 `var(--…)`）
 * @param percent 保留的百分比，0–100
 */
export function mixTransparent(color: string, percent: number): string {
  return `color-mix(in srgb, ${color} ${percent}%, transparent)`
}
