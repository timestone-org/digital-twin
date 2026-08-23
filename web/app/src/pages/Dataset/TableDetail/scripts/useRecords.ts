/**
 * @fileoverview 数据分区的那份状态：一页数据行 + 「下游过期」这条事实。
 *
 * ⚠ 翻页走**游标**不是页码：`dataset_records` 是持续写入的时序集合，页码分页
 * 会静默重复与漏行（docs/DATASET_DESIGN.md §6.1）。因此没有总数，界面只说得出
 * 「第几页」。
 * ⚠ 竞态防护由 `useCursorPages` 里的 `useRacedFetch` 一手包办：翻页与写完之后
 * 的重取会互相追尾，慢的那次后返回就会把屏幕刷成上一页，而且不报任何错。
 */

import { computed, ref, type ComputedRef, type Ref } from 'vue'

import * as dataset from '@/api/dataset'
import { describeError } from '@/composables/useAsyncList'
import { useCursorPages } from '@/composables/useCursorPages'
import {
  pageRange,
  toRecordRows,
  type RecordRange,
  type RecordRow,
} from './recordView'

// 一页多少行。数据表通常很宽，一屏放不下太多行；后端上限 200
export const RECORD_PAGE_SIZE = 50

export interface RecordsView {
  rows: ComputedRef<RecordRow[]>
  loading: Ref<boolean>
  error: Ref<string | null>
  /** 1 起的页序。游标分页给不出总数，所以只说得出这个。 */
  page: ComputedRef<number>
  hasPrev: ComputedRef<boolean>
  hasNext: Ref<boolean>
  /**
   * 有没有行的跨行公式结果已经过期。
   * ⚠ 这条只由**写回执**说了算，前端推断不出来：判据在后端（整表聚合要看
   * 「除了这一行还有没有别的行」，其余情况看「这一刻之后还有没有行」，§5.10）。
   */
  isStale: Ref<boolean>
  /** 当前这一页的最早与最晚数据时间。批量撤销的默认范围取它。 */
  range: ComputedRef<RecordRange>
  /** 回到第一页并清空游标栈。换台账走这条。 */
  reload: () => Promise<void>
  /** 原地重取当前页。写完走这条，别把人甩回第一页。 */
  refresh: () => Promise<void>
  next: () => Promise<void>
  prev: () => Promise<void>
}

/**
 * 装上数据分区的状态。
 * @param tableId 取台账 id；它跟着路由参数走，故是个函数不是常量
 */
export function useRecords(tableId: () => string): RecordsView {
  const isStale = ref(false)
  const pages = useCursorPages(
    (after) =>
      dataset.listDatasetRecords(tableId(), {
        limit: RECORD_PAGE_SIZE,
        ...(after === null ? {} : { after }),
      }),
    describeError,
  )
  const rows = computed(() => toRecordRows(pages.items.value))

  return {
    rows,
    loading: pages.loading,
    error: pages.problem,
    page: pages.pageNumber,
    hasPrev: pages.hasPrev,
    hasNext: pages.hasNext,
    isStale,
    range: computed(() => pageRange(rows.value)),
    // ⚠ 换台账要连「下游过期」一起放掉：那条横幅说的是**另一张表**的事实，
    // 留着会让人去重算一张根本没动过的台账
    reload: async () => {
      isStale.value = false
      await pages.reload()
    },
    refresh: () => pages.refresh(),
    next: () => pages.next(),
    prev: () => pages.prev(),
  }
}
