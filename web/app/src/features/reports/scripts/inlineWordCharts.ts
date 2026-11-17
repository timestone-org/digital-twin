/** @fileoverview 仅在预览副本内替换图表为定位标记，保留 Word 的正文与表格位置。 */
import JSZip from 'jszip'
import type { ReportSchemas } from '@dt/contracts'
import {
  CHART_NS,
  parseWordXml,
  readWordChart,
  wordElements,
} from './wordChart'

const WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const REL_NS =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const EXTENT_NS =
  'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'

export interface InlineWordChart {
  marker: string
  node: ReportSchemas['NodeValue']
  widthCm: number
  heightCm: number
}
export interface ReportPreviewDocument {
  blob: Blob
  charts: InlineWordChart[]
}

async function readXml(zip: JSZip, path: string): Promise<string> {
  const file = zip.file(path)
  if (!file) throw new Error(`报告缺少内部文件：${path}`)
  const xml = await file.async('string')
  if (xml.length > 4_000_000) throw new Error('报告内部文件超出预览范围')
  return xml
}

function chartPath(relations: XMLDocument, id: string): string {
  const relation = Array.from(relations.documentElement.children).find(
    (item) => item.getAttribute('Id') === id,
  )
  const target = relation?.getAttribute('Target') ?? ''
  if (
    relation?.getAttribute('TargetMode') === 'External' ||
    !/^(?:\/word\/)?charts\/[\w.-]+\.xml$/.test(target)
  )
    throw new Error('报告图表引用无效，请下载原件查看')
  return target.startsWith('/') ? target.slice(1) : `word/${target}`
}

function dimension(
  extent: Element | undefined,
  key: string,
  fallback: number,
): number {
  const value = Number(extent?.getAttribute(key)) / 360_000
  return Number.isFinite(value) && value > 0 ? Math.min(value, 60) : fallback
}

/** 保留图表原有位置与尺寸，下载仍使用原件。@param blob Word 原件 */
export async function prepareInlineWordCharts(
  blob: Blob,
): Promise<ReportPreviewDocument> {
  const zip = await JSZip.loadAsync(new Uint8Array(await blob.arrayBuffer()))
  const xml = await readXml(zip, 'word/document.xml')
  const document = parseWordXml(xml)
  const drawings = wordElements(document, WORD_NS, 'drawing').filter(
    (drawing) => wordElements(drawing, CHART_NS, 'chart').length,
  )
  if (!drawings.length) return { blob, charts: [] }
  if (drawings.length > 100) throw new Error('报告图表数量超出预览范围')
  const relations = parseWordXml(
    await readXml(zip, 'word/_rels/document.xml.rels'),
  )
  let prefix = 'DT_REPORT_CHART_'
  while (xml.includes(prefix)) prefix += '_'
  const charts: InlineWordChart[] = []
  for (const drawing of drawings) {
    const id =
      wordElements(drawing, CHART_NS, 'chart')[0]?.getAttributeNS(
        REL_NS,
        'id',
      ) ?? ''
    const node = readWordChart(await readXml(zip, chartPath(relations, id)))
    const marker = `${prefix}${charts.length}__`
    const extent = wordElements(drawing, EXTENT_NS, 'extent')[0]
    charts.push({
      marker,
      node,
      widthCm: dimension(extent, 'cx', 14),
      heightCm: dimension(extent, 'cy', 7.78),
    })
    const text = document.createElementNS(WORD_NS, 'w:t')
    text.textContent = marker
    drawing.replaceWith(text)
  }
  zip.file('word/document.xml', new XMLSerializer().serializeToString(document))
  const bytes = await zip.generateAsync({ type: 'uint8array' })
  return { blob: new Blob([bytes]), charts }
}

/** 把专属定位标记替换为图表宿主。@param host Word 正文 @param charts 图表 */
export function locateWordCharts(host: HTMLElement, charts: InlineWordChart[]) {
  const pending = new Map(charts.map((chart) => [chart.marker, chart]))
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT)
  const anchors: { chart: InlineWordChart; target: HTMLElement }[] = []
  const matches: { text: Node; chart: InlineWordChart }[] = []
  let text = walker.nextNode()
  while (text) {
    const chart = pending.get(text.textContent ?? '')
    if (chart) {
      matches.push({ text, chart })
      pending.delete(chart.marker)
    }
    text = walker.nextNode()
  }
  if (pending.size) throw new Error('报告图表位置未能还原，请下载原件查看')
  for (const { text, chart } of matches) {
    const target = document.createElement('span')
    target.dataset.reportChart = chart.marker
    Object.assign(target.style, {
      display: 'inline-block',
      width: `${chart.widthCm}cm`,
      maxWidth: '100%',
      height: `${chart.heightCm}cm`,
      textIndent: '0',
      verticalAlign: 'middle',
    })
    text.parentNode?.replaceChild(target, text)
    anchors.push({ chart, target })
  }
  return anchors
}
