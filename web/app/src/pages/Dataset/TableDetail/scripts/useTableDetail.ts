/**
 * @fileoverview 台账详情页持有的那份状态：一张台账与它的列。
 *
 * ⚠ 状态只此一份，三个分区组件全部受控、只 emit 不自取数
 * （docs/DATASET_DESIGN.md §7.2）。于是「改了列 → 数据表格的列跟着变」
 * 这类联动只有一条数据流；各分区各取一次的话，同一页上会出现两份列定义，
 * 而它们不一致时界面不会报任何错。
 */

import { ref, type Ref } from 'vue'
import type { DatasetColumn, DatasetTable } from '@dt/contracts'

import * as dataset from '@/api/dataset'
import { describeError } from '@/composables/useAsyncList'
import { useRacedFetch } from '@/composables/useRacedFetch'
import { sortByOrder } from './columnView'

export interface TableDetail {
  table: Ref<DatasetTable | null>
  /** 按 `order_index` 排好的列。顺序即录入表单字段序与数据表列序。 */
  columns: Ref<DatasetColumn[]>
  loading: Ref<boolean>
  error: Ref<string | null>
  /** 取台账详情。回参已带列定义，故进页面只要这一次。 */
  load: () => Promise<void>
  /** 写完列之后只重取列，不重取整张表。 */
  reloadColumns: () => Promise<void>
  /** 就地换一份列顺序，给乐观重排先动界面用。 */
  setColumns: (next: readonly DatasetColumn[]) => void
}

/**
 * 装上详情页的状态。
 * @param tableId 取台账 id；它跟着路由参数走，故是个函数不是常量
 */
export function useTableDetail(tableId: () => string): TableDetail {
  const table = ref<DatasetTable | null>(null)
  const columns = ref<DatasetColumn[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)
  // ⚠ 两条链路各自防竞态：重取列比取详情快得多，共用一个序号的话，
  // 一次「保存列」会把还在飞的那次详情取数判成过期，页面停在空壳上
  const detailRaced = useRacedFetch()
  const columnsRaced = useRacedFetch()

  async function load(): Promise<void> {
    loading.value = true
    error.value = null
    await detailRaced.run(() => dataset.getDatasetTable(tableId()), {
      ok: (result) => {
        table.value = result
        columns.value = sortByOrder(result.columns)
      },
      fail: (caught) => {
        error.value = describeError(caught)
        table.value = null
        columns.value = []
      },
      settled: () => (loading.value = false),
    })
  }

  async function reloadColumns(): Promise<void> {
    await columnsRaced.run(() => dataset.listDatasetColumns(tableId()), {
      ok: (result) => {
        columns.value = sortByOrder(result)
      },
      // ⚠ 重取列失败不清空手上这份：这一步是写成功之后的刷新，清空会让
      // 一次网络抖动看起来像「刚才那一列把整张表删没了」
      fail: (caught) => {
        error.value = describeError(caught)
      },
      settled: () => undefined,
    })
  }

  return {
    table,
    columns,
    loading,
    error,
    load,
    reloadColumns,
    setColumns: (next) => {
      columns.value = [...next]
    },
  }
}
