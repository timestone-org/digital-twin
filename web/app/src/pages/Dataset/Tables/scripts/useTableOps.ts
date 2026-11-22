/**
 * @fileoverview 台账列表页的建改与两段式删除。删除影响以服务端 409 为准，见台账设计 §7.5。
 */

import { ref, type Ref } from 'vue'
import { useRouter, type Router } from 'vue-router'
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
  router: Router
}

export interface TableOps {
  /** 正在改的那一张；`null` 即新建。 */
  editing: Ref<DatasetTableSummary | null>
  isFormOpen: Ref<boolean>
  openCreate: () => void
  openEdit: (table: DatasetTableSummary) => void
  removeTable: (table: DatasetTableSummary) => Promise<void>
  /**
   * 弹窗保存成功后：报一句、重新取数；新建的那次再把人送进列配置。
   * @param message 吐司文案
   * @param createdId 新建出来的台账 id，编辑时为 `null`
   */
  afterSaved: (message: string, createdId: string | null) => Promise<void>
}

/** 取删除可能影响的历史和公式，供用户再次确认。 */
function blockedReason(caught: unknown): string | null {
  if (!(caught instanceof BizError)) return null
  if (caught.code === ERROR_CODES.datasetTableNotEmpty)
    return `${caught.message}，会连同这些历史一并删除，且不可恢复。`
  if (caught.code !== ERROR_CODES.datasetTableInUse) return null
  return (
    [caught.message, ...caught.details.map((detail) => detail.message)].join(
      '。',
    ) + '。'
  )
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
    message: blocked === null ? `${head}这一步不可撤销。` : `${head}${blocked}`,
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
    const blocked = blockedReason(caught)
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
  const deps: Deps = {
    toast: useToast(),
    confirm: useConfirm(),
    reload,
    router: useRouter(),
  }
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
    afterSaved: async (message, createdId) => {
      deps.toast.success(message)
      if (createdId !== null) {
        await deps.router.push(`/datasets/${createdId}/columns`)
        return
      }
      await reload()
    },
  }
}
