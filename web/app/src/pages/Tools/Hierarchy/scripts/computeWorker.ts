/** @fileoverview 图纸与 Excel 的浏览器计算进程。 */
import { arrange } from './arrange'
import type {
  ComputeRequest,
  ComputeResponse,
  ComputeResult,
} from './computeProtocol'
import { generate } from './drawing'
import { DomainError } from './graph'

async function compute(request: ComputeRequest): Promise<ComputeResult> {
  if (request.action === 'draw')
    return { kind: 'drawing', drawing: generate(request.document) }
  if (request.action === 'arrange')
    return { kind: 'document', document: await arrange(request.document) }
  const excel = await import('./excel')
  if (request.action === 'excel-import')
    return {
      kind: 'document',
      document: await excel.importExcel(request.buffer),
    }
  return { kind: 'xlsx', buffer: await excel.exportExcel(request.document) }
}
self.onmessage = (event: MessageEvent<ComputeRequest>) => {
  void compute(event.data)
    .then((result) => {
      const response: ComputeResponse = { ok: true, result }
      self.postMessage(response)
    })
    .catch((error: unknown) => {
      const response: ComputeResponse = {
        ok: false,
        message: error instanceof Error ? error.message : '计算失败',
        issues: error instanceof DomainError ? error.issues : [],
      }
      self.postMessage(response)
    })
}
