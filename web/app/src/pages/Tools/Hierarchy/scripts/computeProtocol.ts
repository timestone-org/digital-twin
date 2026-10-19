/** @fileoverview 页面与绘图 Worker 的有界消息协议。 */
import type { Drawing, GraphDocument, Issue } from './types'
export type ComputeRequest =
  | { action: 'draw' | 'arrange' | 'excel-export'; document: GraphDocument }
  | { action: 'excel-import'; buffer: ArrayBuffer }
export type ComputeResult =
  | { kind: 'drawing'; drawing: Drawing }
  | { kind: 'document'; document: GraphDocument }
  | { kind: 'xlsx'; buffer: Uint8Array<ArrayBuffer> }
export type ComputeResponse =
  | { ok: true; result: ComputeResult }
  | { ok: false; message: string; issues: Issue[] }
