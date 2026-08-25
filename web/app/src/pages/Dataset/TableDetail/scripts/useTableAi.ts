/**
 * @fileoverview 把台账详情页接进助手，并管住那张待确认的公式提议。
 *
 * ⚠ 助手在这一页**只提议、不落库**。大屏编辑器改的是本地草稿（一次 Ctrl+Z
 * 撤得掉），这里每一次写入都是真实落库且没有撤销栈，所以最后那一下由人来按
 * （ADR-0023 的边界那一条）。
 *
 * ⚠ 采纳之后要把预填清掉。不清的话，用户下一次自己点「新增列」，弹窗里会
 * 凭空带着上一条提议的公式——而他多半不会注意到，直接保存。
 */
import { ref, watch, type Ref } from 'vue'
import type { DatasetColumn } from '@dt/contracts'

import { useAiPanel, type AiPanel } from '@/composables/useAiPanel'
import { createTableSurface, type FormulaProposal } from './aiSurface'
import type { ColumnFormSeed } from './columnForm'

export interface TableAiDeps {
  tableId: () => string
  tableName: () => string
  columns: () => readonly DatasetColumn[]
  /** 弹窗此刻开着没有；关上时要把预填清掉。 */
  isFormOpen: Ref<boolean>
  openCreate: () => void
  openEdit: (column: DatasetColumn) => void
}

export interface TableAi {
  panel: AiPanel
  proposal: Ref<FormulaProposal | null>
  /** 传给列弹窗的预填；没有提议在飞时是空的。 */
  seed: Ref<ColumnFormSeed>
  /** 采纳：把表达式带进弹窗。⚠ 保存仍然要用户自己点。 */
  adopt: () => void
  dismiss: () => void
}

/** 把台账详情页接进助手。 */
export function useTableAi(deps: TableAiDeps): TableAi {
  const table = createTableSurface({
    tableId: deps.tableId,
    tableName: deps.tableName,
    columns: deps.columns,
  })
  const panel = useAiPanel({
    surface: () => table.surface,
    refId: () => deps.tableId(),
  })
  const seed = ref<ColumnFormSeed>({})

  watch(deps.isFormOpen, (open) => {
    if (!open) seed.value = {}
  })

  function adopt(): void {
    const staged = table.proposal.value
    if (staged === null) return
    const target = deps
      .columns()
      .find((one) => one.key === staged.columnKey)
    seed.value = { formula: staged.formula, key: staged.columnKey }
    table.clearProposal()
    if (target === undefined) deps.openCreate()
    else deps.openEdit(target)
  }

  return {
    panel,
    proposal: table.proposal,
    seed,
    adopt,
    dismiss: table.clearProposal,
  }
}
