/** @fileoverview 数据源点位的后端关键词与状态查询、分页和空态。 */
import { computed, ref, watch, type ComputedRef, type Ref } from 'vue'
import type {
  CollectPoint,
  CollectPointStatus,
  CollectReadableProtocol,
  DtDataViewEmpty,
} from '@dt/contracts'
import { COLLECT_POINT_STATUSES } from '@dt/contracts'

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
  status: Ref<CollectPointStatus>
  setStatus: (value: string) => void
  list: AsyncList<CollectPoint>
  emptyState: ComputedRef<DtDataViewEmpty>
}

/**
 * 管理点位查询；切状态回第一页，切数据源清除筛选。
 * @param sourceId 取当前数据源 id
 * @param protocol 取当前数据源协议
 */
export function usePointList(
  sourceId: () => string,
  protocol: () => CollectReadableProtocol,
): PointList {
  const keyword = ref('')
  const status = ref<CollectPointStatus>('all')
  const list = useAsyncList<CollectPoint>((query, signal) =>
    collect.listPoints(
      {
        sourceId: sourceId(),
        q: keyword.value || undefined,
        status: status.value,
        ...query,
      },
      signal,
    ),
  )

  const emptyState = computed(() =>
    listEmptyState({
      isFiltered: keyword.value.trim() !== '' || status.value !== 'all',
      subject: '点位',
      keyword: keyword.value,
      blank: { title: '尚未导入点位', hint: EMPTY_HINTS[protocol()] },
    }),
  )

  watch(
    [sourceId, status],
    ([id], previous) => {
      if (id !== previous[0]) {
        keyword.value = ''
        if (status.value !== 'all') {
          status.value = 'all'
          return
        }
      }
      void list.reloadFromFirstPage()
    },
    { immediate: true },
  )

  function setStatus(value: string): void {
    const next = COLLECT_POINT_STATUSES.find((item) => item === value)
    if (next !== undefined) status.value = next
  }

  return { keyword, status, setStatus, list, emptyState }
}
