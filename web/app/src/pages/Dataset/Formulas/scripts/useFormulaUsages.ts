/**
 * @fileoverview 引用反查的取数：哪些台账列在用这一条库公式。
 *
 * ⚠ 这是一次真实的请求而不是列表里现成的字段：台账列与库公式之间只有一条
 * **文本**联系（列公式里的那段 `@标识(`），谁在用它只能重新解析
 * （docs/DATASET_DESIGN.md §5.11）。
 * ⚠ 连点两条公式的「引用」必然并发，故走 `useRacedFetch`：慢的那次后返回会把
 * 另一条公式的引用面画在这一条上，且不报任何错。
 */

import { onScopeDispose, ref, type Ref } from 'vue'
import type { DatasetFormulaDef } from '@dt/contracts'

import * as formulas from '@/api/datasetFormulas'
import { describeError } from '@/composables/useAsyncList'
import { useRacedFetch } from '@/composables/useRacedFetch'

import { usageRows, type FormulaUsageRow } from './formulaView'

export interface FormulaUsagesView {
  /** 正在看哪一条的引用；`null` 即弹窗关着。 */
  target: Ref<DatasetFormulaDef | null>
  rows: Ref<FormulaUsageRow[]>
  loading: Ref<boolean>
  error: Ref<string | null>
  open: (formula: DatasetFormulaDef) => Promise<void>
  close: () => void
  reload: () => Promise<void>
}

export function useFormulaUsages(): FormulaUsagesView {
  const target = ref<DatasetFormulaDef | null>(null)
  const rows = ref<FormulaUsageRow[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)
  const raced = useRacedFetch()

  async function reload(): Promise<void> {
    const formula = target.value
    if (formula === null) return
    loading.value = true
    error.value = null
    await raced.run(
      (signal) => formulas.listDatasetFormulaUsages(formula.id, signal),
      {
        ok: (usages) => (rows.value = usageRows(usages)),
        fail: (caught) => {
          error.value = describeError(caught)
          rows.value = []
        },
        settled: () => (loading.value = false),
      },
    )
  }

  function close(): void {
    // ⚠ 关窗要作废在飞的那一次：不作废的话它之后返回照样会写进一个没人看的
    // 状态，下次开另一条公式时那批行会先闪一下
    raced.cancel()
    target.value = null
    rows.value = []
    error.value = null
    loading.value = false
  }

  onScopeDispose(() => raced.cancel())

  return {
    target,
    rows,
    loading,
    error,
    open: async (formula) => {
      target.value = formula
      rows.value = []
      await reload()
    },
    close,
    reload,
  }
}
