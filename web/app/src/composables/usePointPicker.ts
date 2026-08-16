/**
 * @fileoverview 绑点面板的挑点状态：按关键字与数据源找采集点位。
 * ⚠ 关键字是被连着敲出来的，每一次都会发一个请求——不防竞态的话，
 * 先发后回的那次会把结果覆盖成上一个关键字的，且没有任何报错。
 */

import { ref, type Ref } from 'vue'

import type { CollectPoint } from '@dt/contracts'

import { listPoints } from '@/api/collect'
import { describeError } from '@/composables/useAsyncList'
import { useRacedFetch } from '@/composables/useRacedFetch'

/** 一次最多列这么多点位；再多就该靠关键字缩小范围。 */
const PAGE_SIZE = 50

export interface PointPicker {
  keyword: Ref<string>
  sourceId: Ref<string>
  items: Ref<CollectPoint[]>
  loading: Ref<boolean>
  error: Ref<string | null>
  /** 按当前关键字与数据源重新找。 */
  search: () => Promise<void>
  /** 卸载时掐掉在途请求。 */
  dispose: () => void
}

export function usePointPicker(): PointPicker {
  const keyword = ref('')
  const sourceId = ref('')
  const items = ref<CollectPoint[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  const raced = useRacedFetch()

  async function search(): Promise<void> {
    loading.value = true
    error.value = null
    await raced.run(
      (signal) =>
        listPoints(
          {
            q: keyword.value.trim() === '' ? undefined : keyword.value.trim(),
            sourceId: sourceId.value === '' ? undefined : sourceId.value,
            page: 1,
            size: PAGE_SIZE,
          },
          signal,
        ),
      {
        ok: (page) => (items.value = page.items),
        fail: (caught) => {
          error.value = describeError(caught)
          items.value = []
        },
        settled: () => (loading.value = false),
      },
    )
  }

  return {
    keyword,
    sourceId,
    items,
    loading,
    error,
    search,
    dispose: raced.cancel,
  }
}
