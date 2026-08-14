/**
 * @fileoverview 图表层的取色与换肤重绘：颜色只从 CSS 变量读、源码零色值字面量，
 * 换肤时 canvas 不吃级联，得靠 `useThemeRedraw` 整图重算。
 */
import { observeThemeChange, readToken } from '@dt/tokens'
import { onBeforeUnmount, onMounted, type Ref } from 'vue'

/** 系列色板的 token 名，按序取用、用完循环。 */
export const SERIES_VARS = [
  '--accent-primary',
  '--state-success',
  '--state-warning',
  '--state-danger',
  '--accent-secondary',
  '--state-idle',
] as const

/**
 * 从元素级联读一个 CSS 变量。
 * @param el 读级联的起点，null 时读文档根
 * @param name 变量名，含前导 `--`
 * @param fallback 变量缺席时的取值
 */
export function readCssVar(
  el: Element | null,
  name: string,
  fallback = '',
): string {
  return readToken(name, fallback, el)
}

/** 图表统一主题色。取不到即空串，消费方据此省略该键、交回 echarts 默认。 */
export interface ChartTheme {
  palette: string[]
  text: string
  textMuted: string
  axisLine: string
  splitLine: string
  accent: string
  idle: string
  tooltipBg: string
  tooltipBorder: string
}

/**
 * 从元素读一份完整主题色。
 * @param el 读级联的起点
 */
export function readChartTheme(el: Element | null): ChartTheme {
  return {
    palette: SERIES_VARS.map((name) => readCssVar(el, name)),
    text: readCssVar(el, '--text-primary'),
    textMuted: readCssVar(el, '--text-secondary'),
    axisLine: readCssVar(el, '--border-default'),
    splitLine: readCssVar(el, '--border-subtle'),
    accent: readCssVar(el, '--accent-primary'),
    idle: readCssVar(el, '--state-idle'),
    tooltipBg: readCssVar(el, '--surface-overlay'),
    tooltipBorder: readCssVar(el, '--border-hover'),
  }
}

/**
 * 取色板第 i 个系列色，循环复用；空板或空色 → 空串。
 * @param palette 色板
 * @param index 系列序号
 */
export function seriesColor(palette: readonly string[], index: number): string {
  if (palette.length === 0) return ''
  return palette[index % palette.length] ?? ''
}

/**
 * 只在颜色非空时给出 `{ color }`，否则空对象。
 * ⚠ 别改成写 `color: ''`：echarts 会把空串当成一种颜色画出透明的线，
 * 而不是回退到自己的默认色。
 * @param color 已解析的色值
 */
export function withColor(color: string): { color?: string } {
  return color ? { color } : {}
}

const VAR_EXPR = /^var\(\s*(--[\w-]+)\s*(?:,\s*([^)]*))?\)$/

/**
 * 解析颜色：`var(--x[, fb])` 经 lookup 取实际值，取不到用 var 自带兜底；
 * 普通色串原样返回。
 * @param value 配置里写的颜色
 * @param lookup 变量名 → 实际色值
 */
export function resolveColor(
  value: string | undefined | null,
  lookup: (name: string) => string,
): string {
  const text = (value ?? '').trim()
  if (!text) return ''
  const matched = VAR_EXPR.exec(text)
  if (!matched) return text
  const got = (matched[1] ? lookup(matched[1]) : '').trim()
  return got || (matched[2] ?? '').trim()
}

const HEX_COLOR = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/
const RGB_COLOR = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/

/**
 * 给已解析色叠加透明度。认 `#rgb` / `#rrggbb` / `rgb()` / `rgba()`，
 * 解析不了的原样返回（诚实回退，不猜）。
 * @param color 已解析的色值
 * @param alpha 目标不透明度，钳到 [0,1]
 */
export function withAlpha(color: string, alpha: number): string {
  const text = (color ?? '').trim()
  if (!text) return ''
  const a = Math.max(0, Math.min(1, alpha))
  const hex = HEX_COLOR.exec(text)
  if (hex?.[1]) {
    const full = hex[1].length === 3 ? hex[1].replace(/(.)/g, '$1$1') : hex[1]
    const channels = [0, 2, 4].map((at) => parseInt(full.slice(at, at + 2), 16))
    return `rgba(${channels.join(', ')}, ${a})`
  }
  const rgb = RGB_COLOR.exec(text)
  return rgb ? `rgba(${rgb[1]}, ${rgb[2]}, ${rgb[3]}, ${a})` : text
}

/** 派生色阶的兜底：单主色的三档深浅。 */
function alphaRamp(base: string): string[] {
  if (!base) return []
  return [withAlpha(base, 0.15), withAlpha(base, 0.55), base]
}

function nonEmpty(colors: (string | undefined)[]): string[] {
  return colors.filter((color): color is string => !!color)
}

/**
 * 顺序色阶停靠点（低→高、冷→暖），供连续型 visualMap 用。
 * @param theme 当前主题色
 */
export function sequentialStops(theme: ChartTheme): string[] {
  const p = theme.palette
  const ordered = nonEmpty([p[4], p[0], p[1], p[2], p[3]])
  if (ordered.length >= 2) return ordered
  return alphaRamp(theme.accent || seriesColor(p, 0))
}

/**
 * 发散色阶停靠点（负→中→正），供发散型数据的 visualMap 用。
 * @param theme 当前主题色
 */
export function divergingStops(theme: ChartTheme): string[] {
  const p = theme.palette
  const stops = nonEmpty([p[0], theme.idle || theme.textMuted, p[3]])
  if (stops.length >= 2) return stops
  return alphaRamp(theme.accent || seriesColor(p, 0))
}

/**
 * 换肤时重绘：挂载后侦测主题变化，按帧去抖后回调；卸载时停止观察。
 * @param elRef 读主题的级联根
 * @param redraw 重绘回调，一帧内多次变更只调一次
 */
export function useThemeRedraw(
  elRef: Ref<HTMLElement | null>,
  redraw: () => void,
): void {
  let stop: (() => void) | null = null
  let frame = 0
  const schedule = (): void => {
    if (frame) return
    frame = requestAnimationFrame(() => {
      frame = 0
      redraw()
    })
  }
  onMounted(() => {
    if (elRef.value) stop = observeThemeChange(elRef.value, schedule)
  })
  onBeforeUnmount(() => {
    if (frame) cancelAnimationFrame(frame)
    stop?.()
    stop = null
  })
}
