// @vitest-environment jsdom
/** @fileoverview 图表定位保留左右单元格、正文顺序和原件字节。 */
import JSZip from 'jszip'
import { Blob as NodeBlob } from 'node:buffer'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  locateWordCharts,
  prepareInlineWordCharts,
} from '@/features/reports/scripts/inlineWordCharts'
import {
  parseWordXml,
  readWordChart,
  wordElements,
} from '@/features/reports/scripts/wordChart'

// jsdom 的 Blob 尚未提供 arrayBuffer。
beforeAll(() => vi.stubGlobal('Blob', NodeBlob))
afterAll(() => vi.unstubAllGlobals())

const chartNamespace = 'http://schemas.openxmlformats.org/drawingml/2006/chart'
const wordNamespace =
  'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const relationNamespace =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const extentNamespace =
  'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'

function chartXml(kind = 'line'): string {
  return `<c:chartSpace xmlns:c="${chartNamespace}" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
    <c:chart><c:title><a:t>指数趋势</a:t></c:title><c:plotArea><c:${kind}Chart><c:ser>
    <c:tx><c:strRef><c:f>Sheet1!B1</c:f><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>综合指数</c:v></c:pt></c:strCache></c:strRef></c:tx>
    <c:cat><c:strLit><c:ptCount val="3"/><c:pt idx="0"><c:v>一月</c:v></c:pt><c:pt idx="1"><c:v>二月</c:v></c:pt><c:pt idx="2"><c:v>三月</c:v></c:pt></c:strLit></c:cat>
    <c:val><c:numRef><c:numCache><c:ptCount val="3"/><c:pt idx="0"><c:v>0.5</c:v></c:pt><c:pt idx="2"><c:v>NaN</c:v></c:pt></c:numCache></c:numRef></c:val>
    </c:ser></c:${kind}Chart></c:plotArea></c:chart></c:chartSpace>`
}
function cell(id: string): string {
  return `<w:tc><w:p><w:r><w:drawing><wp:inline><wp:extent cx="2520000" cy="1800000"/>
    <a:graphic><a:graphicData><c:chart r:id="${id}"/></a:graphicData></a:graphic>
    </wp:inline></w:drawing></w:r></w:p></w:tc>`
}
async function reportFixture(target = 'charts/chart1.xml'): Promise<Blob> {
  const zip = new JSZip()
  zip.file(
    'word/document.xml',
    `<w:document xmlns:w="${wordNamespace}" xmlns:c="${chartNamespace}" xmlns:r="${relationNamespace}" xmlns:wp="${extentNamespace}" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><w:body>
    <w:p><w:r><w:t>报告正文 DT_REPORT_CHART_</w:t></w:r></w:p>
    <w:tbl><w:tr>${cell('rIdLeft')}${cell('rIdRight')}</w:tr></w:tbl>
    <w:p><w:r><w:t>报告结尾</w:t></w:r></w:p></w:body></w:document>`,
  )
  zip.file(
    'word/_rels/document.xml.rels',
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdLeft" Target="${target}"/><Relationship Id="rIdRight" Target="/word/charts/chart2.xml"/></Relationships>`,
  )
  zip.file('word/charts/chart1.xml', chartXml())
  zip.file('word/charts/chart2.xml', chartXml('bar'))
  const bytes = await zip.generateAsync({ type: 'uint8array' })
  return new Blob([bytes])
}

describe('Word 原位图表', () => {
  it('左右图表各留在原单元格内，尾段仍在表格后，下载原件不变', async () => {
    const original = await reportFixture()
    const bytes = await original.arrayBuffer()
    const prepared = await prepareInlineWordCharts(original)
    expect(prepared.charts).toHaveLength(2)
    const zip = await JSZip.loadAsync(
      new Uint8Array(await prepared.blob.arrayBuffer()),
    )
    const xml = await zip.file('word/document.xml')?.async('string')
    const document = parseWordXml(xml ?? '')
    const cells = wordElements(document, wordNamespace, 'tc')
    expect(cells[0]?.textContent).toContain(prepared.charts[0]?.marker)
    expect(cells[1]?.textContent).toContain(prepared.charts[1]?.marker)
    expect(document.documentElement.textContent).toContain('报告结尾')
    expect(prepared.charts[0]).toMatchObject({
      widthCm: 7,
      heightCm: 5,
      node: { kind: 'line' },
    })
    expect(prepared.charts[1]?.node.kind).toBe('bar')
    expect(prepared.charts[0]?.marker.startsWith('DT_REPORT_CHART__')).toBe(
      true,
    )
    expect(await original.arrayBuffer()).toEqual(bytes)
  })
  it('DOM 图表宿主分别位于左右单元格，而不是追加到文末', async () => {
    const prepared = await prepareInlineWordCharts(await reportFixture())
    const host = document.createElement('div')
    const table = document.createElement('table')
    const row = table.insertRow()
    row.insertCell().append(document.createElement('span'))
    row.insertCell().append(document.createElement('span'))
    const conclusion = document.createElement('p')
    conclusion.textContent = '结论'
    host.append(table, conclusion)
    host.querySelectorAll('td span').forEach((cell, index) => {
      cell.textContent = prepared.charts[index]?.marker ?? ''
    })
    const anchors = locateWordCharts(host, prepared.charts)
    expect(anchors).toHaveLength(2)
    expect(anchors[0]?.target.closest('td')).toBe(
      host.querySelectorAll('td')[0],
    )
    expect(anchors[1]?.target.closest('td')).toBe(
      host.querySelectorAll('td')[1],
    )
    expect(anchors[0]?.target.style.height).toBe('5cm')
    expect(host.lastElementChild?.textContent).toBe('结论')
  })
  it('图表定位失败时明确拒绝，外部与越界引用不读取', async () => {
    const prepared = await prepareInlineWordCharts(await reportFixture())
    expect(() =>
      locateWordCharts(document.createElement('div'), prepared.charts),
    ).toThrow('位置未能还原')
    await expect(
      prepareInlineWordCharts(
        await reportFixture('https://example.com/chart.xml'),
      ),
    ).rejects.toThrow('引用无效')
    await expect(
      prepareInlineWordCharts(await reportFixture('../chart.xml')),
    ).rejects.toThrow('引用无效')
  })
  it('不含图表时直接沿用原件', async () => {
    const zip = new JSZip()
    zip.file(
      'word/document.xml',
      `<w:document xmlns:w="${wordNamespace}"><w:body/></w:document>`,
    )
    const blob = new Blob([await zip.generateAsync({ type: 'uint8array' })])
    expect(await prepareInlineWordCharts(blob)).toEqual({ blob, charts: [] })
  })
  it.each(['line', 'bar', 'pie'])('读取 %s 的原生缓存，保留缺失值', (kind) => {
    const result = readWordChart(chartXml(kind))
    expect(result.title).toBe('指数趋势')
    expect(result.categories).toEqual(['一月', '二月', '三月'])
    expect(result.series).toEqual([
      { name: '综合指数', points: [], values: ['0.5', null, null] },
    ])
  })
  it('拒绝未知类型和超量缓存', () => {
    expect(() => readWordChart(chartXml('scatter'))).toThrow('暂不支持')
    expect(() =>
      readWordChart(chartXml().replace('val="3"', 'val="20001"')),
    ).toThrow('超出')
  })
  it('缺少可选标题、序列名称与缓存时保留空值', () => {
    const result = readWordChart(
      `<c:chartSpace xmlns:c="${chartNamespace}"><c:lineChart><c:ser/></c:lineChart></c:chartSpace>`,
    )
    expect(result).toMatchObject({
      title: '',
      categories: [],
      series: [{ name: '', points: [], values: [] }],
    })
    const empty = readWordChart(
      `<c:chartSpace xmlns:c="${chartNamespace}"><c:lineChart/></c:chartSpace>`,
    )
    expect(empty.series).toEqual([])
    expect(() => parseWordXml('<broken>')).toThrow('无法读取')
  })
  it('忽略缓存中的越界点，不能用空文本当成零', () => {
    const result = readWordChart(
      chartXml()
        .replace('idx="0"><c:v>0.5', 'idx="9"><c:v>0.5')
        .replace('idx="2"><c:v>NaN', 'idx="1"><c:v> '),
    )
    expect(result.series?.[0]?.values).toEqual([null, null, null])
  })
  it('缺失内部文件和超过图表数量限制时拒绝预览', async () => {
    const empty = new JSZip()
    await expect(
      prepareInlineWordCharts(
        new Blob([await empty.generateAsync({ type: 'uint8array' })]),
      ),
    ).rejects.toThrow('缺少内部文件')
    const zip = new JSZip()
    zip.file(
      'word/document.xml',
      `<w:document xmlns:w="${wordNamespace}" xmlns:c="${chartNamespace}"><w:body>${'<w:drawing><c:chart/></w:drawing>'.repeat(101)}</w:body></w:document>`,
    )
    await expect(
      prepareInlineWordCharts(
        new Blob([await zip.generateAsync({ type: 'uint8array' })]),
      ),
    ).rejects.toThrow('图表数量超出')
  })
  it('原件图表尺寸无效时使用纸面缺省尺寸，超宽图形有界', async () => {
    const blob = await reportFixture()
    const zip = await JSZip.loadAsync(new Uint8Array(await blob.arrayBuffer()))
    const xml = await zip.file('word/document.xml')?.async('string')
    zip.file(
      'word/document.xml',
      (xml ?? '').replaceAll('cx="2520000" cy="1800000"', 'cx="0" cy="NaN"'),
    )
    const prepared = await prepareInlineWordCharts(
      new Blob([await zip.generateAsync({ type: 'uint8array' })]),
    )
    expect(prepared.charts[0]).toMatchObject({ widthCm: 14, heightCm: 7.78 })
  })
})
