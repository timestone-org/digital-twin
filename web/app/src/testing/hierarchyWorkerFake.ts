/** @fileoverview 浏览器 Worker 边界假件；计算仍使用真实排版与 Excel 实现。 */
import type {
  ComputeRequest,
  ComputeResponse,
} from '../pages/Tools/Hierarchy/scripts/computeProtocol'
import { generate } from '../pages/Tools/Hierarchy/scripts/drawing'
import { arrange } from '../pages/Tools/Hierarchy/scripts/arrange'
import {
  exportExcel,
  importExcel,
} from '../pages/Tools/Hierarchy/scripts/excel'
import { DomainError } from '../pages/Tools/Hierarchy/scripts/graph'
export class WorkerFake {
  onmessage: ((event: MessageEvent<ComputeResponse>) => void) | null = null
  onerror: (() => void) | null = null
  terminated = false
  terminate() {
    this.terminated = true
  }
  postMessage(request: ComputeRequest) {
    void this.compute(request).then((response) => {
      if (!this.terminated)
        this.onmessage?.(new MessageEvent('message', { data: response }))
    })
  }
  async compute(request: ComputeRequest): Promise<ComputeResponse> {
    try {
      if (request.action === 'draw')
        return {
          ok: true,
          result: { kind: 'drawing', drawing: generate(request.document) },
        }
      if (request.action === 'arrange')
        return {
          ok: true,
          result: {
            kind: 'document',
            document: await arrange(request.document),
          },
        }
      if (request.action === 'excel-import')
        return {
          ok: true,
          result: {
            kind: 'document',
            document: await importExcel(request.buffer),
          },
        }
      return {
        ok: true,
        result: { kind: 'xlsx', buffer: await exportExcel(request.document) },
      }
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : '计算失败',
        issues: error instanceof DomainError ? error.issues : [],
      }
    }
  }
}
