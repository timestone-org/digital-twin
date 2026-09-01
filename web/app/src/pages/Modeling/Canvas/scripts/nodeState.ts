/**
 * @fileoverview 节点在画布上的四态与它们的显示口径。
 *
 * ⚠ 与后端的节点状态**不是一一对应**：后端有六格（含 pending / cancelling），
 * 画布上只需要分辨「还没跑 / 在跑 / 成了 / 败了 / 跳过」这五种观感。
 */
import type { DtIntent, ModelingNodeStatus } from '@dt/contracts'

/** 画布上的节点观感。 */
export type NodeRunState =
  'idle' | 'running' | 'succeeded' | 'failed' | 'skipped'

/** 后端状态 → 画布观感。认不出来的当「还没跑」。 */
export function stateOf(status: ModelingNodeStatus | undefined): NodeRunState {
  if (status === 'running' || status === 'cancelling') return 'running'
  if (status === 'succeeded') return 'succeeded'
  if (status === 'failed') return 'failed'
  if (status === 'skipped' || status === 'cancelled') return 'skipped'
  return 'idle'
}

/** 每一态的中文标签。 */
export const STATE_LABELS: Record<NodeRunState, string> = {
  idle: '待运行',
  running: '运行中',
  succeeded: '成功',
  failed: '失败',
  skipped: '已跳过',
}

/** 每一态的 DtTag 色档。 */
export const STATE_INTENTS: Record<NodeRunState, DtIntent> = {
  idle: 'neutral',
  running: 'info',
  succeeded: 'success',
  failed: 'danger',
  skipped: 'neutral',
}

/** 一个节点在画布上要显示的全部运行态。 */
export interface NodeRuntime {
  state: NodeRunState
  errorText: string
  hasResult: boolean
}

/** 还没跑过任何一轮时的样子。 */
export const EMPTY_RUNTIME: NodeRuntime = {
  state: 'idle',
  errorText: '',
  hasResult: false,
}
