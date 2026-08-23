/**
 * @fileoverview 数据分区的写动作：录入 / 编辑弹窗、删行、撤销单格修正、重算。
 *
 * ⚠ 每一次写回执都带 `has_stale_downstream`，一律要**接住并立起横幅**：改动或
 * 删掉一条历史行之后，它之后那些行的 `PREV` / 时间窗 / 整表公式结果仍是按旧
 * 数据算出来的。后端只上报、不做级联重算（docs/DATASET_DESIGN.md §5.10），
 * 界面不说这一句的话，那批数就一直是错的且看不出来。
 */

import { ref, type Ref } from 'vue'
import type { DatasetRecord } from '@dt/contracts'
import { useConfirm, useToast } from '@dt/ui'

import * as dataset from '@/api/dataset'
import { describeError } from '@/composables/useAsyncList'
import type { RecordRow, RevokeTarget } from './recordView'
import { recomputeReceipt, revokeCellMessage } from './recordView'
import type { RecordsView } from './useRecords'

export interface RecordOps {
  /** 正在改的那一行；`null` 即录入新行。 */
  editing: Ref<DatasetRecord | null>
  isFormOpen: Ref<boolean>
  isBulkOpen: Ref<boolean>
  /** 有一次写在飞：行内动作跟着禁用，免得连点发出第二次。 */
  busy: Ref<boolean>
  openCreate: () => void
  openEdit: (row: RecordRow) => void
  openBulk: () => void
  removeRecord: (row: RecordRow) => Promise<void>
  revokeCell: (target: RevokeTarget) => Promise<void>
  recompute: () => Promise<void>
  /** 弹窗保存成功后：报一句、接住脏信号、原地重取当前页。 */
  afterSaved: (message: string, hasStale: boolean) => Promise<void>
  /** 批量撤销之后：原地重取当前页。修正撤掉了，取值会跟着变。 */
  afterBulk: () => Promise<void>
}

interface OpsDeps {
  tableId: () => string
  records: RecordsView
  toast: ReturnType<typeof useToast>
  confirm: ReturnType<typeof useConfirm>
  busy: Ref<boolean>
}

/**
 * 删一行。二次确认里要说清删掉的是哪一刻的数据——行与行之间只差一个时刻。
 * @param deps 依赖
 * @param row 那一行
 */
async function removeRecord(deps: OpsDeps, row: RecordRow): Promise<void> {
  const agreed = await deps.confirm.ask({
    title: '删除数据行',
    message: `删除 ${row.time} 这一行？删掉之后它之后那些行的跨行公式结果会失真，需要重算；这一步不可撤销。`,
    confirmText: '删除',
    danger: true,
  })
  if (!agreed) return
  deps.busy.value = true
  try {
    const receipt = await dataset.deleteDatasetRecord({
      tableId: deps.tableId(),
      rowId: row.record.row_id,
      ts: row.record.ts,
    })
    deps.toast.success('数据行已删除')
    noteStale(deps, receipt.has_stale_downstream)
    await deps.records.refresh()
  } catch (caught) {
    deps.toast.error(describeError(caught))
  } finally {
    deps.busy.value = false
  }
}

/**
 * 撤销一格人工修正。
 * ⚠ 回执的 `cleared` 为空**不是失败**：那一格早就没有修正了（别人先撤过、
 * 或手上这一页已经旧了）。报成失败会让人一遍遍重试一件已经完成的事。
 * @param deps 依赖
 * @param target 那一格
 */
async function revokeCell(deps: OpsDeps, target: RevokeTarget): Promise<void> {
  const agreed = await deps.confirm.ask({
    title: '撤销人工修正',
    message: revokeCellMessage(target),
    confirmText: '撤销修正',
    danger: true,
  })
  if (!agreed) return
  deps.busy.value = true
  try {
    const receipt = await dataset.clearDatasetRecordOverrides(
      {
        tableId: deps.tableId(),
        rowId: target.row.record.row_id,
        ts: target.row.record.ts,
      },
      [target.columnKey],
    )
    if (receipt.cleared.length > 0) {
      deps.toast.success(`「${target.columnName}」已回落到自动采集值`)
    } else {
      deps.toast.info('这一格已经没有人工修正了')
    }
    noteStale(deps, receipt.has_stale_downstream)
    await deps.records.refresh()
  } catch (caught) {
    deps.toast.error(describeError(caught))
  } finally {
    deps.busy.value = false
  }
}

/**
 * 重算整表的公式列。
 * ⚠ 只有**整表算完且一行没错**才放下「下游过期」的横幅：触顶的那一次没算完，
 * 收起横幅等于告诉用户已经算好了。
 * @param deps 依赖
 */
async function recompute(deps: OpsDeps): Promise<void> {
  deps.busy.value = true
  try {
    const receipt = recomputeReceipt(
      await dataset.recomputeDatasetTable(deps.tableId()),
    )
    if (receipt.isPartial) deps.toast.warning(receipt.text)
    else {
      deps.toast.success(receipt.text)
      deps.records.isStale.value = false
    }
    await deps.records.refresh()
  } catch (caught) {
    deps.toast.error(describeError(caught))
  } finally {
    deps.busy.value = false
  }
}

/**
 * 接住一次写回执里的脏信号。
 * ⚠ 只置真不置假：另一次写留下的过期不会因为这一次写干净了就消失。
 * @param deps 依赖
 * @param hasStale 回执里的 `has_stale_downstream`
 */
function noteStale(deps: OpsDeps, hasStale: boolean): void {
  if (hasStale) deps.records.isStale.value = true
}

/**
 * 装上数据分区的写动作。
 * @param tableId 取台账 id
 * @param records 分区那份状态：写完要原地重取，脏信号也落在它上面
 */
export function useRecordOps(
  tableId: () => string,
  records: RecordsView,
): RecordOps {
  const busy = ref(false)
  const deps: OpsDeps = {
    tableId,
    records,
    toast: useToast(),
    confirm: useConfirm(),
    busy,
  }
  const editing = ref<DatasetRecord | null>(null)
  const isFormOpen = ref(false)
  const isBulkOpen = ref(false)

  return {
    editing,
    isFormOpen,
    isBulkOpen,
    busy,
    openCreate: () => {
      editing.value = null
      isFormOpen.value = true
    },
    openEdit: (row) => {
      editing.value = row.record
      isFormOpen.value = true
    },
    openBulk: () => (isBulkOpen.value = true),
    removeRecord: (row) => removeRecord(deps, row),
    revokeCell: (target) => revokeCell(deps, target),
    recompute: () => recompute(deps),
    afterSaved: async (message, hasStale) => {
      deps.toast.success(message)
      noteStale(deps, hasStale)
      await records.refresh()
    },
    afterBulk: () => records.refresh(),
  }
}
