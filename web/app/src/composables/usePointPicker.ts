/**
 * @fileoverview 绑点面板的挑点状态：按关键字与数据源找采集点位。
 * ⚠ 关键字是被连着敲出来的，每一次都会发一个请求——不防竞态的话，
 * 先发后回的那次会把结果覆盖成上一个关键字的，且没有任何报错。
 */

import { computed, ref, type ComputedRef, type Ref } from 'vue'

import type { CollectPoint } from '@dt/contracts'

import { listPoints } from '@/api/collect'
import { describeError } from '@/composables/useAsyncList'
import { useRacedFetch } from '@/composables/useRacedFetch'

/**
 * 一次最多列这么多点位；再多就该靠关键字缩小范围。
 * ⚠ 导出是为了让界面能把「只列了前几个」说成一个具体的数：写成两份字面量时，
 * 改了这里而没改那句话，提示语会开始骗人。
 */
export const POINT_PICKER_PAGE_SIZE = 50

export interface PointPicker {
  keyword: Ref<string>
  sourceId: Ref<string>
  items: Ref<CollectPoint[]>
  /**
   * 符合条件的点位一共有多少个。
   * ⚠ 它与 `items.length` 不是一回事：一页只列 `POINT_PICKER_PAGE_SIZE` 个，
   * 两者对不上就是「还有没列出来的」。不摆出这个数，用户会以为看到的就是全部，
   * 在清单里找一个明明存在的点位，怎么也找不到。
   */
  total: Ref<number>
  /** 这一页有没有列全。 */
  hasMore: ComputedRef<boolean>
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
  const total = ref(0)
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
            size: POINT_PICKER_PAGE_SIZE,
          },
          signal,
        ),
      {
        ok: (page) => {
          items.value = page.items
          total.value = page.total
        },
        fail: (caught) => {
          error.value = describeError(caught)
          items.value = []
          total.value = 0
        },
        settled: () => (loading.value = false),
      },
    )
  }

  return {
    keyword,
    sourceId,
    items,
    total,
    hasMore: computed(() => total.value > items.value.length),
    loading,
    error,
    search,
    dispose: raced.cancel,
  }
}
