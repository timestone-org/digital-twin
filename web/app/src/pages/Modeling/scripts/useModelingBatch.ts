/** @fileoverview 建模列表选择、分页作用域与批次运行生命周期。 */
import { computed, onBeforeUnmount, watch } from 'vue'
import { ModelingBatchRuntime } from './modelingBatchRuntime'
import type { ModelingBatchAction, ModelingBatchRow } from './modelingBatch'

export function useModelingBatch<TRow extends ModelingBatchRow>(
  rows: () => readonly TRow[],
  rowLabel: (row: TRow) => string,
  scope?: () => unknown,
) {
  const runtime = new ModelingBatchRuntime(rowLabel)
  const selectedIds = runtime.selectedIds
  const state = runtime.state
  const selectedRows = computed(() => {
    const selected = new Set(selectedIds.value)
    return rows().filter((row) => selected.has(row.id))
  })
  const selectedCount = computed(() => selectedRows.value.length)
  const isBusy = computed(() => state.value.isBusy)
  const isBlocked = computed(() =>
    state.value.outcomes.some((row) => row.status === 'unknown'),
  )
  const canRun = computed(
    () => selectedCount.value > 0 && !isBusy.value && !isBlocked.value,
  )
  watch(
    () => rows().map((row) => row.id),
    (ids) => {
      const available = new Set(ids)
      selectedIds.value = selectedIds.value.filter((id) => available.has(id))
    },
  )
  if (scope) watch(scope, () => runtime.invalidate())
  onBeforeUnmount(() => runtime.dispose())
  return {
    selectedIds,
    selectedRows,
    selectedCount,
    state,
    isBusy,
    isBlocked,
    canRun,
    run: (operation: ModelingBatchAction<TRow>) =>
      runtime.run(selectedRows.value, operation),
    clear: () => runtime.clear(),
    stop: () => runtime.stop(),
  }
}
