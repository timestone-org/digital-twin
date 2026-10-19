/** @fileoverview 导入为新项目，导出始终使用当前完整配置。 */
import { useToast } from '@dt/ui'
import { ref } from 'vue'
import {
  download,
  filename,
  pngBlob,
  printDrawing,
  svgBlob,
} from './exportDrawing'
import { object, validate } from './graph'
import type { Drawing, ExportFormat, GraphDocument } from './types'
import type { useHierarchyCompute } from './useHierarchyCompute'

export function createState(compute: ReturnType<typeof useHierarchyCompute>) {
  const busy = ref(false)
  const toast = useToast()
  return { busy, toast, compute }
}

export class Controller {
  constructor(readonly state: ReturnType<typeof createState>) {}
  importFile = async (file: File): Promise<GraphDocument | null> => {
    if (file.size > 5000000) throw new Error('配置文件不能超过 5 MB')
    if (file.name.toLowerCase().endsWith('.xlsx')) {
      const result = await this.state.compute.run({
        action: 'excel-import',
        buffer: await file.arrayBuffer(),
      })
      return result?.kind === 'document' ? result.document : null
    }
    if (!file.name.toLowerCase().endsWith('.json'))
      throw new Error('请选择 .json 或 .xlsx 配置文件')
    const input: unknown = JSON.parse(await file.text())
    const record = object(input)
    return validate(
      record['format'] === 'layerflow.project' ? record['document'] : input,
    )
  }
  exportFile = async (format: ExportFormat, document: GraphDocument) => {
    if (this.state.busy.value) return
    const target = format === 'pdf' ? window.open('', '_blank') : null
    if (format === 'pdf' && !target)
      throw new Error('请允许打开打印窗口，再导出 PDF')
    if (target) target.opener = null
    this.state.busy.value = true
    try {
      await this.exportContent(format, validate(document), target)
    } catch (error) {
      target?.close()
      throw error
    } finally {
      this.state.busy.value = false
    }
  }
  exportContent = async (
    format: ExportFormat,
    document: GraphDocument,
    target: Window | null,
  ) => {
    const name = filename(document.title)
    if (format === 'json') {
      download(
        new Blob(
          [
            JSON.stringify(
              { format: 'layerflow.project', schemaVersion: 1, document },
              null,
              2,
            ),
          ],
          { type: 'application/json' },
        ),
        `${name}.layerflow.json`,
      )
      return
    }
    const result = await this.state.compute.run({
      action: format === 'xlsx' ? 'excel-export' : 'draw',
      document,
    })
    if (result?.kind === 'xlsx')
      download(
        new Blob([result.buffer], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }),
        `${name}.xlsx`,
      )
    else if (result?.kind === 'drawing') {
      await this.exportImage(format, result.drawing, document.title, target)
    } else {
      target?.close()
      if (this.state.compute.error.value)
        throw new Error(this.state.compute.error.value)
    }
  }
  exportImage = async (
    format: ExportFormat,
    drawing: Drawing,
    title: string,
    target: Window | null,
  ) => {
    const name = filename(title)
    if (format === 'svg') download(svgBlob(drawing), `${name}.svg`)
    if (format === 'png') download(await pngBlob(drawing), `${name}.png`)
    if (format === 'pdf' && target) {
      await printDrawing(target, drawing, title)
      this.state.toast.info('在打印对话框选择“保存为 PDF”，可保留完整矢量图纸')
    }
  }
}
