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
import type {
  CollectPoint,
  CollectReadableProtocol,
  DtDataViewEmpty,
} from '@dt/contracts'

import * as collect from '@/api/collect'
import { useAsyncList, type AsyncList } from '@/composables/useAsyncList'
import { listEmptyState } from '@/utils/listEmpty'

const EMPTY_HINTS: Record<CollectReadableProtocol, string> = {
  opcua: '打开地址浏览，勾选变量节点并导入，或用 CSV 批量导入。',
  modbus_tcp: '新增寄存器点位并配置寻址串，或用 CSV 批量导入。',
  http: '从 JSON 样例生成点位，或新增点位并配置 JSON Pointer。',
}

export interface PointList {
  keyword: Ref<string>
  list: AsyncList<CollectPoint>
  emptyState: ComputedRef<DtDataViewEmpty>
}

/**
 * 装上点位列表。换源时自己清词回第一页，调用方只管拿。
 * @param sourceId 取当前数据源 id
 * @param protocol 取当前数据源协议
 */
export function usePointList(
  sourceId: () => string,
  protocol: () => CollectReadableProtocol,
): PointList {
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
      blank: { title: '尚未导入点位', hint: EMPTY_HINTS[protocol()] },
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
