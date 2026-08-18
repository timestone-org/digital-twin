/**
 * @fileoverview 一个数据源下的点位列表：取数、关键词、以及列表空着时说什么。
 *
 * ⚠ 空态分两种，合成一种会造出一条**让人做错事**的引导：搜不到时若说「去浏览树
 * 里勾选导入」，工程师真的会再导一遍，于是同一批点位被导入两次（见
 * `utils/listEmpty`）。
 * ⚠ 换源要连搜索词一起清：留着上一台设备的关键词，新源的表会「一个点位都没有」，
 * 而那台设备其实好好的。
 */
import { computed, ref, watch, type ComputedRef, type Ref } from 'vue'
import type { CollectPoint, DtDataViewEmpty } from '@dt/contracts'

import * as collect from '@/api/collect'
import { useAsyncList, type AsyncList } from '@/composables/useAsyncList'
import { listEmptyState } from '@/utils/listEmpty'

const BLANK_EMPTY: DtDataViewEmpty = {
  title: '尚未导入点位',
  hint: '在左侧浏览树中勾选变量节点并导入，或用 CSV 批量导入。',
}

export interface PointList {
  keyword: Ref<string>
  list: AsyncList<CollectPoint>
  emptyState: ComputedRef<DtDataViewEmpty>
}

/**
 * 装上点位列表。换源时自己清词回第一页，调用方只管拿。
 * @param sourceId 取当前数据源 id
 */
export function usePointList(sourceId: () => string): PointList {
  const keyword = ref('')
  const list = useAsyncList<CollectPoint>((query) =>
    collect.listPoints({
      sourceId: sourceId(),
      q: keyword.value || undefined,
      ...query,
    }),
  )

  const emptyState = computed(() =>
    listEmptyState({
      isFiltered: keyword.value.trim() !== '',
      subject: '点位',
      keyword: keyword.value,
      blank: BLANK_EMPTY,
    }),
  )

  watch(
    sourceId,
    () => {
      keyword.value = ''
      void list.reloadFromFirstPage()
    },
    { immediate: true },
  )

  return { keyword, list, emptyState }
}
