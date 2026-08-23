/**
 * @fileoverview 台账列表页的写动作：开建表 / 改表弹窗，与两段式删除。
 *
 * ⚠ 删除是**两段式**，第二段的文案由后端的 409 回执撑起来：先发一次不带
 * `force` 的删除，后端说「下面还有 N 行数据」时再问一次，确认词从「删除」
 * 变成「仍然删除」（docs/DATASET_DESIGN.md §7.5）。
 * 刻意不在点删除之前先查一次行数：查完到用户点确认之间，行数可能已经变了。
 * ⚠ 删除的两步是模块级函数、只收一份 `deps`：塞回 composable 里会让它涨成一个
 * 谁也不敢动的大函数。
 */

import { ref, type Ref } from 'vue'
import type { DatasetTableSummary } from '@dt/contracts'
import { ERROR_CODES } from '@dt/contracts'
import { useConfirm, useToast } from '@dt/ui'

import * as dataset from '@/api/dataset'
import { BizError } from '@/api/client'
import { describeError } from '@/composables/useAsyncList'

interface Deps {
  toast: ReturnType<typeof useToast>
  confirm: ReturnType<typeof useConfirm>
  reload: () => Promise<void>
}

export interface TableOps {
  /** 正在改的那一张；`null` 即新建。 */
  editing: Ref<DatasetTableSummary | null>
  isFormOpen: Ref<boolean>
  openCreate: () => void
  openEdit: (table: DatasetTableSummary) => void
  removeTable: (table: DatasetTableSummary) => Promise<void>
  /** 弹窗保存成功后：报一句、重新取数。 */
  afterSaved: (message: string) => Promise<void>
}

/**
 * 后端是不是因为「下面还有数据行」拒绝的。
 * ⚠ 按码分支，不按 message：文案会改、会翻译。而返回的**是** message ——
 * 有多少行只在那句话里，前端不许自己再查一遍（设计 §7.5）。
 * @param caught 抛出来的东西
 */
function recordsBlockedReason(caught: unknown): string | null {
  const isBlocked =
    caught instanceof BizError &&
    caught.code === ERROR_CODES.datasetTableNotEmpty
  return isBlocked ? caught.message : null
}

/**
 * 问一次。`blocked` 是后端第一次拒绝时给的那句话，给了就是第二段确认。
 * @param deps 吐司、确认框与重取
 * @param table 要删的台账
 * @param blocked 后端说的拒绝原因，`null` 即第一段
 */
function askRemove(
  deps: Deps,
  table: DatasetTableSummary,
  blocked: string | null,
): Promise<boolean> {
  const head = `将删除台账「${table.name}」及它的全部列定义。`
  return deps.confirm.ask({
    title: '删除台账',
    message:
      blocked === null
        ? `${head}这一步不可撤销。`
        : `${head}${blocked}，会连同这些历史一并删除，且不可恢复。`,
    confirmText: blocked === null ? '删除' : '仍然删除',
    danger: true,
  })
}

async function afterRemoved(deps: Deps): Promise<void> {
  deps.toast.success('台账已删除')
  await deps.reload()
}

/** 连历史一起删。到这一步用户已经看过具体后果并确认过了。 */
async function forceRemove(
  deps: Deps,
  table: DatasetTableSummary,
): Promise<void> {
  try {
    await dataset.deleteDatasetTable(table.id, true)
  } catch (caught) {
    deps.toast.error(describeError(caught))
    return
  }
  await afterRemoved(deps)
}

async function removeTable(
  deps: Deps,
  table: DatasetTableSummary,
): Promise<void> {
  if (!(await askRemove(deps, table, null))) return
  try {
    await dataset.deleteDatasetTable(table.id)
  } catch (caught) {
    const blocked = recordsBlockedReason(caught)
    if (blocked === null) {
      deps.toast.error(describeError(caught))
      return
    }
    if (await askRemove(deps, table, blocked)) await forceRemove(deps, table)
    return
  }
  await afterRemoved(deps)
}

/**
 * 装上这一页的写动作。
 * @param reload 写完之后重新取数
 */
export function useTableOps(reload: () => Promise<void>): TableOps {
  const deps: Deps = { toast: useToast(), confirm: useConfirm(), reload }
  const editing = ref<DatasetTableSummary | null>(null)
  const isFormOpen = ref(false)

  return {
    editing,
    isFormOpen,
    openCreate: () => {
      editing.value = null
      isFormOpen.value = true
    },
    openEdit: (table) => {
      editing.value = table
      isFormOpen.value = true
    },
    removeTable: (table) => removeTable(deps, table),
    afterSaved: async (message) => {
      deps.toast.success(message)
      await reload()
    },
  }
}
