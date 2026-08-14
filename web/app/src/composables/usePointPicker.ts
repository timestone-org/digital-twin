/**
 * @fileoverview 绑点面板的挑点状态：按关键字与数据源找采集点位。
 * ⚠ 关键字是被连着敲出来的，每一次都会发一个请求——不防竞态的话，
 * 先发后回的那次会把结果覆盖成上一个关键字的，且没有任何报错。
 */

import { ref, type Ref } from 'vue'

import { listPoints, type CollectPoint } from '@/api/collect'
import { describeError } from '@/composables/useAsyncList'

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

  let sequence = 0
  let inFlight: AbortController | null = null

  async function search(): Promise<void> {
    inFlight?.abort()
    const controller = new AbortController()
    inFlight = controller
    sequence += 1
    const mine = sequence
    loading.value = true
    error.value = null
    try {
      const page = await listPoints(
        {
          q: keyword.value.trim() === '' ? undefined : keyword.value.trim(),
          sourceId: sourceId.value === '' ? undefined : sourceId.value,
          page: 1,
          size: PAGE_SIZE,
        },
        controller.signal,
      )
      // ⚠ 只有最后一次发起的查询能写结果
      if (mine !== sequence) return
      items.value = page.items
    } catch (caught) {
      if (mine !== sequence) return
      error.value = describeError(caught)
      items.value = []
    } finally {
      if (mine === sequence) loading.value = false
    }
  }

  function dispose(): void {
    inFlight?.abort()
    inFlight = null
    sequence += 1
  }

  return { keyword, sourceId, items, loading, error, search, dispose }
}
