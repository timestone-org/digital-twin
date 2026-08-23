/**
 * @fileoverview 删一列的两段式流程。
 *
 * ⚠ 先发一次不带 `force` 的删除，后端说「还有几列的公式引用着它」时再问一次，
 * 确认词从「删除」变成「仍然删除」，而且第二句话要**点名那几列**
 * （docs/DATASET_DESIGN.md §7.5）。刻意不在点删除之前先查一遍「谁引用了它」：
 * 查完到用户点确认之间，公式可能已经改了。
 * ⚠ 两段拆成模块级函数、只收一份 `deps`：塞回 composable 里会让它涨成一个
 * 谁也不敢动的大函数。
 */

import type { Ref } from 'vue'
import type { DatasetColumn } from '@dt/contracts'
import { ERROR_CODES } from '@dt/contracts'
import type { useConfirm, useToast } from '@dt/ui'

import * as dataset from '@/api/dataset'
import { BizError } from '@/api/client'
import { describeError } from '@/composables/useAsyncList'

export interface ColumnDeleteDeps {
  toast: ReturnType<typeof useToast>
  confirm: ReturnType<typeof useConfirm>
  tableId: () => string
  /** 现有的列，用来把引用者的列标识翻成人看得懂的名字。 */
  columns: Ref<DatasetColumn[]>
  reloadColumns: () => Promise<void>
}

// 后端把引用者摊成 `columns[列标识]` 的字段路径，见 platform-server 的 _dependent_detail
const DEPENDENT_FIELD = /^columns\[(.+)]$/

/**
 * 后端是不是因为「还被公式引用」拒绝的；是的话回引用它的那几列的列标识。
 * ⚠ 按码分支，不按 message：文案会改、会翻译。而**是谁引用了它**只在信封的
 * `details` 里，message 只说得出一个条数。
 * @param caught 抛出来的东西
 */
export function referencedKeys(caught: unknown): string[] | null {
  if (
    !(caught instanceof BizError) ||
    caught.code !== ERROR_CODES.datasetColumnInUse
  ) {
    return null
  }
  return caught.details.flatMap((one) => {
    const matched = DEPENDENT_FIELD.exec(one.field)
    return matched?.[1] === undefined ? [] : [matched[1]]
  })
}

/**
 * 列标识 → 「列名称」。查不到就原样用标识：宁可显示一个不好看的名字，
 * 也不能把「有引用者」说成「没有」。
 * @param columns 现有的列
 * @param keys 引用者的列标识
 */
function nameThem(
  columns: readonly DatasetColumn[],
  keys: readonly string[],
): string {
  return keys
    .map((key) => columns.find((one) => one.key === key)?.name ?? key)
    .map((name) => `「${name}」`)
    .join('、')
}

/**
 * 问一次。`referenced` 非空即第二段确认。
 * @param deps 吐司、确认框与重取
 * @param column 要删的列
 * @param referenced 引用它的那几列的列标识；`null` 即第一段
 */
function askRemove(
  deps: ColumnDeleteDeps,
  column: DatasetColumn,
  referenced: readonly string[] | null,
): Promise<boolean> {
  const head = `将删除列「${column.name}」。`
  const isBlocked = referenced !== null && referenced.length > 0
  const tail = isBlocked
    ? `${nameThem(deps.columns.value, referenced ?? [])} 的公式引用着它，删掉之后这几列会算不出数，要你逐条改过来。`
    : '这一列已经录进去的值仍留在库里，但不再展示、也不再参与计算。'
  return deps.confirm.ask({
    title: '删除列',
    message: `${head}${tail}`,
    confirmText: isBlocked ? '仍然删除' : '删除',
    danger: true,
  })
}

async function afterRemoved(deps: ColumnDeleteDeps): Promise<void> {
  deps.toast.success('列已删除')
  await deps.reloadColumns()
}

/** 连引用一起删。到这一步用户已经看过具体后果并确认过了。 */
async function forceRemove(
  deps: ColumnDeleteDeps,
  column: DatasetColumn,
): Promise<void> {
  try {
    await dataset.deleteDatasetColumn(deps.tableId(), column.id, true)
  } catch (caught) {
    deps.toast.error(describeError(caught))
    return
  }
  await afterRemoved(deps)
}

/**
 * 删一列，必要时升一级再问一次。
 * @param deps 吐司、确认框与重取
 * @param column 要删的列
 */
export async function removeColumn(
  deps: ColumnDeleteDeps,
  column: DatasetColumn,
): Promise<void> {
  if (!(await askRemove(deps, column, null))) return
  try {
    await dataset.deleteDatasetColumn(deps.tableId(), column.id)
  } catch (caught) {
    const referenced = referencedKeys(caught)
    if (referenced === null) {
      deps.toast.error(describeError(caught))
      return
    }
    if (await askRemove(deps, column, referenced)) {
      await forceRemove(deps, column)
    }
    return
  }
  await afterRemoved(deps)
}
