/**
 * @fileoverview 折线图 tooltip 的渲染。
 * ⚠ echarts 的 tooltip 默认按 HTML 渲染，而系列名与量纲是外部数据：
 * 这里一律建 DOM 节点、取值只经 textContent 落地，**不拼 HTML 字符串**。
 */
import { formatLocalMinute } from '../datetime'
import type { DtChartSeries } from './series'

/** echarts 悬停回调给的一项，只声明本模块真的会读的字段。 */
export interface DtTooltipParam {
  seriesIndex?: number | undefined
  color?: string | undefined
  value?: unknown
}

const MISSING = '—' // 断档：没有取值，不是 0
const MARKER = '●' // 系列色点

function isPair(value: unknown): value is readonly [unknown, unknown] {
  return Array.isArray(value) && value.length >= 2
}

/**
 * 取一个点的第 index 位数字；不是 `[时刻, 取值]` 形状就当没有取值。
 * @param value 回调里那一项的 value
 * @param index 0 取时刻，1 取读数
 */
function numberAt(value: unknown, index: 0 | 1): number | null {
  if (!isPair(value)) return null
  const found = value[index]
  return typeof found === 'number' ? found : null
}

function textNode(tag: 'div' | 'span', text: string): HTMLElement {
  const node = document.createElement(tag)
  node.textContent = text
  return node
}

/**
 * 一条系列在这一刻的读数行：色点 + 名字 + 取值（带量纲）。
 * @param param 回调里那一项
 * @param series 对应的系列定义，下标对不上时为 undefined
 */
function seriesRow(
  param: DtTooltipParam,
  series: DtChartSeries | undefined,
): HTMLElement {
  const row = document.createElement('div')
  const dot = textNode('span', MARKER)
  // 取自 echarts 已解析的系列色，而系列色来自 @dt/tokens 的调色板
  dot.style.color = param.color ?? 'inherit'
  dot.style.marginRight = '6px'
  const reading = numberAt(param.value, 1)
  const text = reading === null ? MISSING : `${reading}${series?.unit ?? ''}`
  row.append(dot, textNode('span', `${series?.name ?? ''} ${text}`))
  return row
}

/**
 * 造一个 tooltip formatter：按 `seriesIndex` 回查名字与量纲。
 * ⚠ 只在 `trigger: 'axis'` 下成立——那时 echarts 一定给数组。
 * @param series 与 option 里 series 同序的系列定义
 */
export function createTooltipFormatter(
  series: readonly DtChartSeries[],
): (params: readonly DtTooltipParam[]) => HTMLElement {
  return (params) => {
    const box = document.createElement('div')
    const stamp = numberAt(params[0]?.value, 0)
    box.appendChild(
      textNode('div', stamp === null ? '' : formatLocalMinute(stamp)),
    )
    for (const param of params) {
      box.appendChild(seriesRow(param, series[param.seriesIndex ?? -1]))
    }
    return box
  }
}
