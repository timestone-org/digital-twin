/** @fileoverview 建模批量操作的逐项结果与串行执行，不重试未知写入。 */
import { BizError } from '@/api/client'
import { describeError } from '@/composables/useAsyncList'

export interface ModelingBatchRow {
  id: string
}
export type ModelingBatchOutcomeStatus =
  'succeeded' | 'failed' | 'unknown' | 'skipped'
export interface ModelingBatchOutcome {
  id: string
  label: string
  status: ModelingBatchOutcomeStatus
  message: string
}
export interface ModelingBatchState {
  label: string
  isBusy: boolean
  completed: number
  total: number
  outcomes: readonly ModelingBatchOutcome[]
}
export interface ModelingBatchReport {
  outcomes: readonly ModelingBatchOutcome[]
  succeeded: number
  failed: number
  unknown: number
  skipped: number
}
export interface ModelingBatchContext {
  read: <TResult>(
    load: (signal: AbortSignal) => Promise<TResult>,
  ) => Promise<TResult>
  isActive: () => boolean
  ensureActive: () => void
}
export interface ModelingBatchAction<TRow> {
  label: string
  message: string
  danger?: boolean
  isConfirmed?: boolean
  action: (row: TRow, context: ModelingBatchContext) => Promise<unknown>
  skip?: (row: TRow) => string | null
}
interface Execution<TRow> {
  rows: readonly TRow[]
  operation: ModelingBatchAction<TRow>
  rowLabel: (row: TRow) => string
  context: ModelingBatchContext
  onOutcome: (outcome: ModelingBatchOutcome) => void
}
export class ModelingBatchStopped extends Error {}
export class ModelingBatchRejected extends Error {}
export class ModelingBatchSkipped extends Error {}

function failureStatus(caught: unknown): 'failed' | 'unknown' | 'skipped' {
  if (
    caught instanceof ModelingBatchStopped ||
    caught instanceof ModelingBatchSkipped
  )
    return 'skipped'
  if (caught instanceof ModelingBatchRejected) return 'failed'
  if (!(caught instanceof BizError)) return 'unknown'
  if (
    caught.status >= 500 ||
    caught.status === 408 ||
    caught.code === 41443 ||
    caught.code === 41444
  )
    return 'unknown'
  return 'failed'
}

function failureMessage(caught: unknown): string {
  if (
    caught instanceof ModelingBatchRejected ||
    caught instanceof ModelingBatchSkipped
  )
    return caught.message
  if (caught instanceof ModelingBatchStopped)
    return caught.message || '已停止，此项未提交'
  return describeError(caught)
}

async function executeItem<TRow extends ModelingBatchRow>(
  row: TRow,
  input: Execution<TRow>,
): Promise<ModelingBatchOutcome> {
  const identity = { id: row.id, label: input.rowLabel(row) }
  try {
    const reason = input.operation.skip?.(row)
    if (reason) return { ...identity, status: 'skipped', message: reason }
    input.context.ensureActive()
    await input.operation.action(row, input.context)
    return { ...identity, status: 'succeeded', message: '成功' }
  } catch (caught) {
    const status = failureStatus(caught)
    return {
      ...identity,
      status,
      message: failureMessage(caught),
    }
  }
}

export async function executeModelingBatch<TRow extends ModelingBatchRow>(
  input: Execution<TRow>,
): Promise<ModelingBatchReport> {
  const outcomes: ModelingBatchOutcome[] = []
  let hasUnknown = false
  for (const row of input.rows) {
    const outcome: ModelingBatchOutcome =
      hasUnknown || !input.context.isActive()
        ? {
            id: row.id,
            label: input.rowLabel(row),
            status: 'skipped',
            message: hasUnknown
              ? '前一项结果待核查，此项未提交'
              : '批次已停止，此项未提交',
          }
        : await executeItem(row, input)
    outcomes.push(outcome)
    input.onOutcome(outcome)
    hasUnknown ||= outcome.status === 'unknown'
  }
  return {
    outcomes,
    succeeded: outcomes.filter((row) => row.status === 'succeeded').length,
    failed: outcomes.filter((row) => row.status === 'failed').length,
    unknown: outcomes.filter((row) => row.status === 'unknown').length,
    skipped: outcomes.filter((row) => row.status === 'skipped').length,
  }
}
