/**
 * @fileoverview 图表族用例的公共夹具：一份取值可辨认的主题、一个按路径取值的读取器，
 * 以及 option 里 series 的取法。option 的类型是 echarts 的联合体，用例逐层点下去
 * 会被类型挡住，故统一从这里过一道。
 * ⚠ 测试设施，不进产物——生产代码引用它由结构闸拦下。
 */
import type { ChartTheme } from '../shared/chart/theme'

/**
 * 各项取值互不相同的假主题：断言里看到哪个字符串，就知道那处用的是哪一档颜色。
 * 刻意不写真实色值——用例只比对取值有没有落到该落的键上。
 */
export const FAKE_THEME: ChartTheme = {
  palette: ['p0', 'p1', 'p2'],
  text: 'text',
  textMuted: 'muted',
  axisLine: 'axis',
  splitLine: 'split',
  accent: 'accent',
  idle: 'idle',
  tooltipBg: 'bg',
  tooltipBorder: 'border',
}

/** 假取色器：`var(--x)` 一律解析成 `var:x`，取不到的变量给空串。 */
export function fakeResolve(name: string): string {
  return name.startsWith('--') ? `var:${name.slice(2)}` : ''
}

/**
 * 按点号路径取值，路径上任何一段不是对象就给 undefined。
 * @param source option 或它的任意子结构
 * @param path 形如 `series.0.data.1`
 */
export function pick(source: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((node, key) => {
    if (node === null || typeof node !== 'object') return undefined
    return (node as Record<string, unknown>)[key]
  }, source)
}

/**
 * 取 option 里的 series 数组；没有就给空数组。
 * @param option 构建出来的 option
 */
export function seriesOf(option: unknown): Record<string, unknown>[] {
  const series = pick(option, 'series')
  return Array.isArray(series) ? (series as Record<string, unknown>[]) : []
}
