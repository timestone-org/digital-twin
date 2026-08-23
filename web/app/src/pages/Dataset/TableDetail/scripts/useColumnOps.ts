/**
 * @fileoverview 列配置分区的写动作：开新增 / 编辑弹窗、删除与乐观重排。
 *
 * 两段式删除在 `columnDelete.ts`，这里只把依赖凑齐再交给它。
 */

import { ref, type Ref } from 'vue'
import type { DatasetColumn } from '@dt/contracts'
import { useConfirm, useToast } from '@dt/ui'

import * as dataset from '@/api/dataset'
import { describeError } from '@/composables/useAsyncList'
import { removeColumn, type ColumnDeleteDeps } from './columnDelete'
import { sortByOrder } from './columnView'

/** 详情页交下来的那份状态与重取入口。 */
export interface ColumnOpsDeps {
  tableId: () => string
  columns: Ref<DatasetColumn[]>
  setColumns: (next: readonly DatasetColumn[]) => void
  reloadColumns: () => Promise<void>
}

export interface ColumnOps {
  /** 正在改的那一列；`null` 即新增。 */
  editing: Ref<DatasetColumn | null>
  isFormOpen: Ref<boolean>
  /** 有一次重排或删除在飞：上下移与行内动作跟着禁用。 */
  busy: Ref<boolean>
  openCreate: () => void
  openEdit: (column: DatasetColumn) => void
  removeColumn: (column: DatasetColumn) => Promise<void>
  /** 上移 / 下移一列。先动界面，失败再整份重取回滚。 */
  moveColumn: (column: DatasetColumn, delta: -1 | 1) => Promise<void>
  /** 弹窗保存成功后：报一句、重取列。 */
  afterSaved: (message: string) => Promise<void>
}

interface MoveDeps extends ColumnOpsDeps {
  toast: ReturnType<typeof useToast>
  busy: Ref<boolean>
}

/**
 * 交换相邻两列并落库。
 * ⚠ 先动界面再发请求：上下移是连点操作，等一个来回再动会让人以为没点上。
 * 失败的回滚是**整份重取**而不是把它换回来——期间别人可能也改了顺序，
 * 换回来等于拿一份想当然的顺序覆盖真实的那份。
 * @param deps 台账 id、列状态、吐司与忙标
 * @param column 要动的那一列
 * @param delta -1 上移，1 下移
 */
async function moveColumn(
  deps: MoveDeps,
  column: DatasetColumn,
  delta: -1 | 1,
): Promise<void> {
  const list = [...deps.columns.value]
  const from = list.findIndex((one) => one.id === column.id)
  const to = from + delta
  const moved = list[from]
  const other = list[to]
  if (moved === undefined || other === undefined) return
  list[from] = other
  list[to] = moved
  deps.setColumns(list)
  deps.busy.value = true
  try {
    const saved = await dataset.reorderDatasetColumns(
      deps.tableId(),
      list.map((one) => one.id),
    )
    deps.setColumns(sortByOrder(saved))
  } catch (caught) {
    deps.toast.error(describeError(caught))
    await deps.reloadColumns()
  } finally {
    deps.busy.value = false
  }
}

/**
 * 装上列配置分区的写动作。
 * @param deps 台账 id、列状态与写完之后的重取
 */
export function useColumnOps(deps: ColumnOpsDeps): ColumnOps {
  const toast = useToast()
  const busy = ref(false)
  const move: MoveDeps = { ...deps, toast, busy }
  const remove: ColumnDeleteDeps = {
    ...deps,
    toast,
    confirm: useConfirm(),
  }
  const editing = ref<DatasetColumn | null>(null)
  const isFormOpen = ref(false)

  return {
    editing,
    isFormOpen,
    busy,
    openCreate: () => {
      editing.value = null
      isFormOpen.value = true
    },
    openEdit: (column) => {
      editing.value = column
      isFormOpen.value = true
    },
    // ⚠ 删除期间也要把行内动作禁掉：确认框开着的时候还能点第二次删除，
    // 第二次那一下会拿着已经删掉的那一列再发一次请求
    removeColumn: async (column) => {
      busy.value = true
      try {
        await removeColumn(remove, column)
      } finally {
        busy.value = false
      }
    },
    moveColumn: (column, delta) => moveColumn(move, column, delta),
    afterSaved: async (message) => {
      toast.success(message)
      await deps.reloadColumns()
    },
  }
}
