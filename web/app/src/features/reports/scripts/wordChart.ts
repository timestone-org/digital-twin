/** @fileoverview 从 Word 原生图表缓存读取生成时数据，不重新查询台账。 */
import type { ReportSchemas } from '@dt/contracts'

export const CHART_NS = 'http://schemas.openxmlformats.org/drawingml/2006/chart'
const DRAWING_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main'

/** 解析受支持的 Word XML。@param xml 压缩包内的 XML */
export function parseWordXml(xml: string): XMLDocument {
  const document = new DOMParser().parseFromString(xml, 'application/xml')
  if (document.getElementsByTagName('parsererror').length)
    throw new Error('报告中的 XML 无法读取')
  return document
}

/** 按 XML 命名空间及大小写匹配子孙元素。@param parent 根 @param namespace 命名空间 @param name 本地名 */
export function wordElements(
  parent: Document | Element,
  namespace: string,
  name: string,
): Element[] {
  return Array.from(parent.getElementsByTagName('*')).filter(
    (item) => item.namespaceURI === namespace && item.localName === name,
  )
}

function first(parent: Element | undefined, name: string): Element | undefined {
  return parent ? wordElements(parent, CHART_NS, name)[0] : undefined
}

function cachedValues(parent: Element | undefined): (string | null)[] {
  if (!parent) return []
  const count = cacheCount(parent)
  const values: (string | null)[] = Array.from({ length: count }, () => null)
  for (const point of wordElements(parent, CHART_NS, 'pt')) {
    const index = pointIndex(point, count)
    if (index !== null) values[index] = first(point, 'v')?.textContent ?? null
  }
  return values
}

function cacheCount(parent: Element): number {
  const count = Number(first(parent, 'ptCount')?.getAttribute('val') ?? 0)
  if (!Number.isSafeInteger(count) || count < 0 || count > 20_000)
    throw new Error('报告图表数据量超出预览范围')
  return count
}

function pointIndex(point: Element, count: number): number | null {
  const index = Number(point.getAttribute('idx'))
  return Number.isSafeInteger(index) && index >= 0 && index < count
    ? index
    : null
}

/** 折线、柱图与饼图直接消费 Word 内嵌的缓存。@param xml 图表 XML */
export function readWordChart(xml: string): ReportSchemas['NodeValue'] {
  const document = parseWordXml(xml)
  const root = document.documentElement
  const kind = (['line', 'bar', 'pie'] as const).find((value) =>
    first(root, `${value}Chart`),
  )
  if (!kind) throw new Error('这类 Word 图表暂不支持预览，请下载原件')
  const plot = first(root, `${kind}Chart`)
  if (!plot) throw new Error('报告图表缺少绘图区')
  const title = first(root, 'title')
  const series = wordElements(plot, CHART_NS, 'ser')
  return {
    kind,
    title: title
      ? wordElements(title, DRAWING_NS, 't')
          .map((item) => item.textContent ?? '')
          .join('')
      : '',
    x_axis: 'category',
    categories: cachedValues(series[0] && first(series[0], 'cat')).map(
      (value) => value ?? '',
    ),
    series: series.map((item) => ({
      name: first(first(item, 'tx'), 'v')?.textContent ?? '',
      points: [],
      values: cachedValues(first(item, 'val')).map((value) =>
        value !== null && value.trim() !== '' && Number.isFinite(Number(value))
          ? value
          : null,
      ),
    })),
  }
}
