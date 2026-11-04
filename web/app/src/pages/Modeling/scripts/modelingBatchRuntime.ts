/** @fileoverview 建模批次的确认所有权、可取消准备读取及不可重试写入。 */
import { useConfirm } from '@dt/ui'
import { ref, shallowRef } from 'vue'
import { describeError } from '@/composables/useAsyncList'
import { useRacedFetch } from '@/composables/useRacedFetch'
import {
  executeModelingBatch,
  ModelingBatchRejected,
  ModelingBatchStopped,
} from './modelingBatch'
import type {
  ModelingBatchAction,
  ModelingBatchContext,
  ModelingBatchOutcome,
  ModelingBatchReport,
  ModelingBatchRow,
  ModelingBatchState,
} from './modelingBatch'

function emptyState(): ModelingBatchState {
  return { label: '', isBusy: false, completed: 0, total: 0, outcomes: [] }
}
type Preparation<TResult> =
  { status: 'succeeded'; value: TResult } | { status: 'failed'; error: unknown }

export class ModelingBatchRuntime<TRow extends ModelingBatchRow> {
  readonly selectedIds = ref<string[]>([])
  readonly state = shallowRef<ModelingBatchState>(emptyState())
  private readonly reader = useRacedFetch()
  private readonly confirm = useConfirm()
  private isDisposed = false
  private isStopped = false
  private isCurrent = true
  private confirmationId: number | null = null
  private readonly context: ModelingBatchContext = {
    read: (load) => this.prepare(load),
    isActive: () => this.isActive(),
    ensureActive: () => this.ensureActive(),
  }
  constructor(private readonly rowLabel: (row: TRow) => string) {}
  private isActive(): boolean {
    return !this.isDisposed && !this.isStopped && this.isCurrent
  }
  private ensureActive(): void {
    if (!this.isActive())
      throw new ModelingBatchStopped('批次已停止，此项未提交')
  }
  private async prepare<TResult>(
    load: (signal: AbortSignal) => Promise<TResult>,
  ): Promise<TResult> {
    this.ensureActive()
    const result: { response?: Preparation<TResult> } = {}
    await this.reader.run(load, {
      ok: (value) => {
        result.response = { status: 'succeeded', value }
      },
      fail: (error) => {
        result.response = { status: 'failed', error }
      },
      settled: () => {},
    })
    this.ensureActive()
    const response = result.response
    if (!response) throw new ModelingBatchStopped('读取已停止，此项未提交')
    if (response.status === 'failed')
      throw new ModelingBatchRejected(describeError(response.error))
    return response.value
  }
  stop(): void {
    this.isStopped = true
    // ⚠ reader 只管理写入前的 GET，不中止已经提交的写请求。
    this.reader.cancel()
    if (
      this.confirmationId !== null &&
      this.confirm.pending.value?.id === this.confirmationId
    )
      this.confirm.resolve(false)
    this.confirmationId = null
  }
  clear(): void {
    if (this.state.value.isBusy) return
    this.selectedIds.value = []
    this.state.value = emptyState()
  }
  invalidate(): void {
    this.isCurrent = false
    this.stop()
    this.selectedIds.value = []
    const previous = this.state.value
    const outcomes =
      previous.isBusy ||
      previous.outcomes.some((row) => row.status === 'unknown')
        ? previous.outcomes.filter((row) => row.status === 'unknown')
        : previous.outcomes
    this.state.value = {
      label: previous.label,
      isBusy: previous.isBusy,
      completed: outcomes.length,
      total: outcomes.length,
      outcomes,
    }
  }
  dispose(): void {
    this.isDisposed = true
    this.stop()
  }
  private async confirmOperation(
    operation: ModelingBatchAction<TRow>,
    count: number,
  ): Promise<boolean> {
    if (operation.isConfirmed) return true
    const answer = this.confirm.ask({
      title: `${operation.label} ${count} 项？`,
      message: operation.message,
      confirmText: operation.label,
      ...(operation.danger ? { danger: true } : {}),
    })
    this.confirmationId = this.confirm.pending.value?.id ?? null
    try {
      return await answer
    } finally {
      this.confirmationId = null
    }
  }
  private record(outcome: ModelingBatchOutcome): void {
    if (this.isDisposed || (!this.isCurrent && outcome.status !== 'unknown'))
      return
    const outcomes = [...this.state.value.outcomes, outcome]
    this.state.value = {
      ...this.state.value,
      outcomes,
      completed: outcomes.length,
      total: Math.max(this.state.value.total, outcomes.length),
    }
    if (outcome.status === 'succeeded')
      this.selectedIds.value = this.selectedIds.value.filter(
        (id) => id !== outcome.id,
      )
  }
  private canStart(rows: readonly TRow[]): boolean {
    return (
      rows.length > 0 &&
      !this.isDisposed &&
      !this.state.value.isBusy &&
      !this.state.value.outcomes.some((row) => row.status === 'unknown')
    )
  }

  async run(
    rows: readonly TRow[],
    operation: ModelingBatchAction<TRow>,
  ): Promise<ModelingBatchReport | null> {
    if (!this.canStart(rows)) return null
    const snapshot = [...rows]
    this.isStopped = false
    this.isCurrent = true
    this.state.value = {
      ...emptyState(),
      label: operation.label,
      isBusy: true,
      total: snapshot.length,
    }
    try {
      const accepted = await this.confirmOperation(operation, snapshot.length)
      if (!accepted || !this.isActive()) {
        if (!this.isDisposed && this.isCurrent) this.state.value = emptyState()
        return null
      }
      const report = await executeModelingBatch({
        rows: snapshot,
        operation,
        rowLabel: this.rowLabel,
        context: this.context,
        onOutcome: (outcome) => this.record(outcome),
      })
      return this.isDisposed || !this.isCurrent ? null : report
    } finally {
      if (!this.isDisposed)
        this.state.value = { ...this.state.value, isBusy: false }
    }
  }
}
