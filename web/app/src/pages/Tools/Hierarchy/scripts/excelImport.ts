/** @fileoverview Excel 图配置的行级校验与新文档读取。 */
import { newClientUuid } from '@/api/idempotency'
import type ExcelJS from 'exceljs'
import { arrange } from './arrange'
import { checkArchive } from './excelArchive'
import { DomainError, validate } from './graph'
import type { GraphDocument, GraphEdge, GraphNode } from './types'

const NODE_COLUMNS = [
  '编号',
  '名称',
  '圆内下栏',
  '类型',
  '同层顺序',
  '画布X',
  '画布Y',
  '节点ID',
]
const EDGE_COLUMNS = ['上级编号', '下级编号', '连接ID']
type CellValue = string | number
interface Sheet {
  source: ExcelJS.Worksheet
  get: (row: number, name: string) => CellValue
}
function fail(sheet: ExcelJS.Worksheet, row: number, message: string): never {
  throw new DomainError(
    `“${sheet.name}”第 ${row} 行：${message}`,
    'EXCEL_INVALID',
  )
}
function value(cell: ExcelJS.Cell): CellValue {
  const content = cell.value
  if (content === null || content === undefined) return ''
  if (typeof content === 'string' || typeof content === 'number') return content
  if (typeof content === 'object' && 'richText' in content)
    return content.richText.map((part) => part.text).join('')
  return fail(
    cell.worksheet,
    Number(cell.row),
    `${cell.address} 请填写文字或数字，不支持公式、日期或错误单元格`,
  )
}
function sheet(
  book: ExcelJS.Workbook,
  name: string,
  required: string[],
  limit: number,
): Sheet {
  const source = book.getWorksheet(name)
  if (!source)
    throw new DomainError(`缺少“${name}”工作表，请使用导出的 Excel 配置模板`)
  if (source.rowCount > limit) throw new DomainError(`“${name}”工作表行数过多`)
  const columns = new Map<string, number>()
  source.getRow(1).eachCell((cell, column) => {
    const caption = String(value(cell)).trim()
    if (columns.has(caption)) fail(source, 1, `表头“${caption}”重复`)
    columns.set(caption, column)
  })
  for (const caption of required)
    if (!columns.has(caption)) fail(source, 1, `缺少“${caption}”列`)
  return {
    source,
    get: (row, caption) => {
      const column = columns.get(caption)
      return column === undefined ? '' : value(source.getCell(row, column))
    },
  }
}
function numeric(
  sheet: Sheet,
  row: number,
  input: CellValue,
  name: string,
  fallback: number,
): number {
  if (String(input).trim() === '') return fallback
  const number = Number(input)
  if (!Number.isFinite(number))
    return fail(sheet.source, row, `${name}必须是有效数字`)
  return number
}
function metadata(book: ExcelJS.Workbook): GraphDocument {
  const project = sheet(book, '项目', ['设置', '值'], 100)
  const settings = new Map<string, { value: CellValue; row: number }>()
  for (let row = 2; row <= project.source.rowCount; row++) {
    const key = String(project.get(row, '设置')).trim()
    if (!key) continue
    if (settings.has(key)) fail(project.source, row, `设置“${key}”重复`)
    settings.set(key, { value: project.get(row, '值'), row })
  }
  const read = (key: string) => settings.get(key)?.value ?? ''
  const number = (key: string, fallback: number) =>
    numeric(project, settings.get(key)?.row ?? 1, read(key), key, fallback)
  if (
    read('文件格式') !== 'layerflow.xlsx' ||
    Number(read('配置版本')) !== 1 ||
    read('模板') !== 'case-v1'
  )
    throw new DomainError(
      '不是层绘 v1 Excel 配置，请保留文件格式、配置版本和模板',
    )
  return {
    schemaVersion: 1,
    templateId: 'case-v1',
    title: String(read('项目名称')),
    nodes: [],
    edges: [],
    paper: { width: number('图纸宽度(px)', 1516) },
    viewport: {
      x: number('视图X', 50),
      y: number('视图Y', 40),
      zoom: number('视图缩放', 1),
    },
  }
}
function readNode(
  nodes: Sheet,
  row: number,
  document: GraphDocument,
): GraphNode {
  const get = (name: string) => nodes.get(row, name)
  const kind = String(get('类型')).trim()
  if (kind !== '计量节点' && kind !== '汇流点')
    return fail(nodes.source, row, '类型必须为计量节点或汇流点')
  const node: GraphNode = {
    id: String(get('节点ID')).trim() || newClientUuid(),
    code: String(get('编号')).trim(),
    name: String(get('名称')).trim(),
    parameter: String(get('圆内下栏')).trim(),
    kind: kind === '计量节点' ? 'meter' : 'junction',
    order: numeric(nodes, row, get('同层顺序'), '同层顺序', row - 1),
    position: {
      x: numeric(nodes, row, get('画布X'), '画布X', 0),
      y: numeric(nodes, row, get('画布Y'), '画布Y', 0),
    },
  }
  try {
    validate({ ...document, nodes: [node], edges: [] })
  } catch (error) {
    fail(nodes.source, row, error instanceof Error ? error.message : '节点无效')
  }
  return node
}
function readNodes(book: ExcelJS.Workbook, document: GraphDocument) {
  const nodes = sheet(book, '节点', NODE_COLUMNS.slice(0, 4), 1001)
  const codes = new Map<string, string>(),
    ids = new Set<string>()
  let needsLayout = false
  for (let row = 2; row <= nodes.source.rowCount; row++) {
    if (
      NODE_COLUMNS.every(
        (column) => String(nodes.get(row, column)).trim() === '',
      )
    )
      continue
    const node = readNode(nodes, row, document)
    if (codes.has(node.code) || ids.has(node.id))
      fail(nodes.source, row, '编号或节点ID重复；新行的ID可以留空')
    if (
      String(nodes.get(row, '画布X')).trim() === '' ||
      String(nodes.get(row, '画布Y')).trim() === ''
    )
      needsLayout = true
    document.nodes.push(node)
    codes.set(node.code, node.id)
    ids.add(node.id)
  }
  return { codes, needsLayout }
}
function readEdge(
  edges: Sheet,
  row: number,
  codes: Map<string, string>,
): GraphEdge {
  const sourceCode = String(edges.get(row, '上级编号')).trim(),
    targetCode = String(edges.get(row, '下级编号')).trim()
  const source = codes.get(sourceCode),
    target = codes.get(targetCode)
  if (!source || !target)
    return fail(
      edges.source,
      row,
      `找不到编号“${!source ? sourceCode : targetCode}”，请与节点表保持一致`,
    )
  return {
    id: String(edges.get(row, '连接ID')).trim() || newClientUuid(),
    source,
    target,
  }
}
function readEdges(
  book: ExcelJS.Workbook,
  document: GraphDocument,
  codes: Map<string, string>,
) {
  const edges = sheet(book, '连接', EDGE_COLUMNS.slice(0, 2), 5001)
  for (let row = 2; row <= edges.source.rowCount; row++) {
    if (
      EDGE_COLUMNS.every(
        (column) => String(edges.get(row, column)).trim() === '',
      )
    )
      continue
    document.edges.push(readEdge(edges, row, codes))
    try {
      validate(document)
    } catch (error) {
      fail(
        edges.source,
        row,
        error instanceof Error ? error.message : '连接无效',
      )
    }
  }
}
export async function importExcel(data: ArrayBuffer): Promise<GraphDocument> {
  await checkArchive(data)
  const { default: Excel } = await import('exceljs')
  const book = new Excel.Workbook()
  try {
    await book.xlsx.load(data)
  } catch {
    throw new DomainError('Excel 文件读取失败，请确认是未加密的 .xlsx 工作簿')
  }
  if (book.worksheets.length > 10) throw new DomainError('Excel 工作表过多')
  const document = metadata(book),
    nodes = readNodes(book, document)
  readEdges(book, document, nodes.codes)
  const valid = validate(document)
  return nodes.needsLayout ? arrange(valid) : valid
}
