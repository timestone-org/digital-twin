/** @fileoverview 兼容 Layerflow v1 的 Excel 配置导出。 */
import type ExcelJS from 'exceljs'
import type { GraphDocument } from './types'
import { validate } from './graph'
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
function table(
  book: ExcelJS.Workbook,
  name: string,
  headers: string[],
  widths: number[],
) {
  const sheet = book.addWorksheet(name, {
    views: [{ state: 'frozen', ySplit: 1 }],
  })
  sheet.columns = headers.map((header, i) => ({
    header,
    width: widths[i] ?? 18,
  }))
  sheet.getRow(1).height = 30
  sheet.getRow(1).eachCell((cell) => {
    cell.font = {
      name: 'Microsoft YaHei',
      size: 11,
      bold: true,
      color: { argb: 'FFFFFFFF' },
    }
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF51469C' },
    }
    cell.alignment = { vertical: 'middle' }
  })
  return sheet
}
function finish(sheet: ExcelJS.Worksheet) {
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(2, sheet.rowCount), column: sheet.columnCount },
  }
  sheet.eachRow((row, index) => {
    if (index === 1) return
    row.height = 36
    row.eachCell((cell) => {
      cell.font = {
        name: 'Microsoft YaHei',
        size: 11,
        color: { argb: 'FF263550' },
      }
      cell.alignment = { vertical: 'middle', wrapText: true }
      if (typeof cell.value === 'string') cell.numFmt = '@'
      if (index % 2 === 0)
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFF3F1FA' },
        }
    })
  })
}
export async function exportExcel(
  original: unknown,
): Promise<Uint8Array<ArrayBuffer>> {
  const { default: Excel } = await import('exceljs')
  const document = validate(original),
    book = new Excel.Workbook()
  book.creator = 'DigitalTwin'
  book.created = new Date()
  const nodes = table(
    book,
    '节点',
    NODE_COLUMNS,
    [18, 32, 18, 16, 14, 14, 14, 40],
  )
  document.nodes.forEach((n) =>
    nodes.addRow([
      n.code,
      n.name,
      n.parameter,
      n.kind === 'meter' ? '计量节点' : '汇流点',
      n.order,
      n.position.x,
      n.position.y,
      n.id,
    ]),
  )
  for (let row = 2; row <= 301; row++)
    nodes.getCell(row, 4).dataValidation = {
      type: 'list',
      allowBlank: false,
      formulae: ['"计量节点,汇流点"'],
      showErrorMessage: true,
      errorTitle: '节点类型',
      error: '请选择计量节点或汇流点',
    }
  const codes = new Map(document.nodes.map((n) => [n.id, n.code]))
  const edges = table(book, '连接', EDGE_COLUMNS, [20, 20, 40])
  document.edges.forEach((e) =>
    edges.addRow([codes.get(e.source), codes.get(e.target), e.id]),
  )
  const project = projectSheet(book, document)
  const help = helpSheet(book)

  for (const sheet of [nodes, edges, project, help]) finish(sheet)
  help.eachRow((row, i) => {
    if (i > 1) row.height = 50
  })
  return new Uint8Array(await book.xlsx.writeBuffer())
}

function helpSheet(book: ExcelJS.Workbook) {
  const help = table(book, '使用说明', ['项目', '说明'], [24, 100])
  help.addRows([
    [
      '编辑节点',
      '在“节点”表中修改编号、名称、圆内下栏和类型；保留表头，可增加或删除数据行。编号必须唯一，建议使用文本格式以保留前导零。',
    ],
    [
      '编辑连接',
      '在“连接”表每行填写一对上级编号、下级编号。多上级使用多行；修改节点编号时，也要同步修改连接表中的编号。',
    ],
    [
      '新增节点与连线',
      '新增行的节点ID、连接ID可以留空，导入时自动生成；已有ID建议保留。计量节点与汇流点均支持导入。',
    ],
    [
      '自动整理',
      '画布X、画布Y保留时还原编辑位置；任何节点的坐标留空，导入后会自动整理整个画布。同层顺序为空时按表格顺序生成；出图优先按上级分组，该顺序用于分支内部，以减少交叉。',
    ],
    [
      '图纸宽度',
      '在“项目”表设置图纸宽度(px)，范围360～12000，约3.78 px对应1 mm；高度自动延伸。同层仅在宽度放不下时续行。',
    ],
    [
      '导入行为',
      '导入为一个新项目，不覆盖现有项目。空表可作为模板。节点最多300个，连接最多2000条；支持.xlsx，不支持旧版.xls。',
    ],
    [
      '校验规则',
      '禁止重复编号、重复连接、自连接、循环、无效引用和公式单元格。导入失败会指出表格位置，原项目不受影响。',
    ],
    [
      '标准图',
      '名称最多两行，圆内文字最多约5个汉字或10个英文字符；超出容量可保存配置，但生成时会提示修改。',
    ],
  ])

  return help
}

function projectSheet(book: ExcelJS.Workbook, document: GraphDocument) {
  const project = table(book, '项目', ['设置', '值'], [25, 56])
  project.addRows([
    ['文件格式', 'layerflow.xlsx'],
    ['配置版本', 1],
    ['项目名称', document.title],
    ['模板', document.templateId],
    ['图纸宽度(px)', document.paper.width],
    ['视图X', document.viewport.x],
    ['视图Y', document.viewport.y],
    ['视图缩放', document.viewport.zoom],
  ])

  return project
}
