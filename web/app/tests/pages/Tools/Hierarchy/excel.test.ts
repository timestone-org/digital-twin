// @vitest-environment node
/** @fileoverview Excel 互导保留图身份，并在行级拒绝不安全配置。 */
import { expect, it } from 'vitest'
import ExcelJS from 'exceljs'
import { SAMPLE } from '../../../../src/pages/Tools/Hierarchy/scripts/sample'
import {
  exportExcel,
  importExcel,
} from '../../../../src/pages/Tools/Hierarchy/scripts/excel'
import { required } from '../../../../src/pages/Tools/Hierarchy/scripts/required'

it('保留多上级、中文、前导零、坐标、宽度和文本等号', async () => {
  const document = structuredClone(SAMPLE)
  const node = required(document.nodes[0])
  node.code = '001'
  node.name = '=文本\n第二行'
  document.paper.width = 2245
  document.edges.push({ id: 'multi', source: 's2', target: 'm2' })
  expect(await importExcel((await exportExcel(document)).buffer)).toEqual(
    document,
  )
  const empty = { ...document, nodes: [], edges: [] }
  expect(await importExcel((await exportExcel(empty)).buffer)).toEqual(empty)
})
async function edited(edit: (book: ExcelJS.Workbook) => void) {
  const book = new ExcelJS.Workbook()
  await book.xlsx.load((await exportExcel(SAMPLE)).buffer)
  edit(book)
  return new Uint8Array(await book.xlsx.writeBuffer()).buffer
}
it('新增无 ID 的节点并在缺坐标时整理全图', async () => {
  const buffer = await edited((book) => {
    const nodes = required(book.getWorksheet('节点'))
    nodes.getCell('F2').value = null
    nodes.getRow(36).values = ['NEW', '新增节点', '1.0级', '计量节点', 100]
    required(book.getWorksheet('连接')).addRow(['Z1-01', 'NEW', ''])
  })
  const document = await importExcel(buffer)
  expect(document.nodes).toHaveLength(35)
  expect(document.nodes.find((node) => node.code === 'NEW')?.id).toBeTruthy()
  expect(required(document.nodes[0]).position.y).toBe(50)
})
it.each([
  ['节点', 'A2', { formula: '1+1', result: 2 }, /节点.*2.*公式/],
  ['节点', 'A3', 'Z1-01', /节点.*3.*重复/],
  ['连接', 'B2', '不存在', /连接.*2.*不存在/],
  ['节点', 'F2', 'abc', /节点.*2.*画布X/],
] satisfies [string, string, ExcelJS.CellValue, RegExp][])(
  '拒绝 %s %s 的非法输入',
  async (sheet, cell, value, error) => {
    const buffer = await edited((book) => {
      required(book.getWorksheet(sheet)).getCell(cell).value = value
    })
    await expect(importExcel(buffer)).rejects.toThrow(error)
  },
)
it('拒绝循环、损坏压缩目录和超限文件', async () => {
  const cyclic = await edited((book) => {
    required(book.getWorksheet('连接')).addRow(['Z2-01', 'Z1-01'])
  })
  await expect(importExcel(cyclic)).rejects.toThrow(/连接.*循环/)
  await expect(importExcel(new ArrayBuffer(4))).rejects.toThrow(/Excel/)
  await expect(importExcel(new ArrayBuffer(5_000_001))).rejects.toThrow(/Excel/)
  const bytes = await exportExcel(SAMPLE),
    view = new DataView(bytes.buffer)
  let end = bytes.length - 22
  while (end > 0 && view.getUint32(end, true) !== 0x06054b50) end--
  const directory = view.getUint32(end + 16, true)
  view.setUint32(directory + 24, 40_000_001, true)
  await expect(importExcel(bytes.buffer)).rejects.toThrow(/Excel/)
})
