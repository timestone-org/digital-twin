/**
 * @fileoverview 列表页共用的取数状态机：分页 + 加载中 / 出错 / 数据 + 竞态防护。
 *
 * ⚠ 竞态防护是必须的，不是可选的：筛选条件被快速切换时，慢的那次请求后返回
 * 会覆盖快的那次的结果，界面显示过期数据**且没有任何报错**。
 */

import { computed, ref, shallowRef, type ComputedRef, type Ref } from 'vue'
import type { Page } from '@dt/contracts'
import type { DtPaginationState } from '@dt/ui'

import { BizError, TransportError } from '@/api/client'

/** 把后端与网络错误归一成一句能给用户看的话。 */
export function describeError(caught: unknown): string {
  if (caught instanceof BizError) return caught.message || '请求失败'
  if (caught instanceof TransportError) return caught.message
  return '请求失败，请重试'
}

export interface AsyncListPage {
  page: number
  size: number
}

export interface AsyncList<TItem> {
  items: Ref<TItem[]>
  total: Ref<number>
  loading: Ref<boolean>
  error: Ref<string | null>
  /** 直接喂给 DtDataView 的 `pagination`。 */
  pager: ComputedRef<DtPaginationState>
  reload: () => Promise<void>
  /** 翻页并重新取数。 */
  goToPage: (page: number) => Promise<void>
  /** 改每页条数并重新取数。 */
  setSize: (size: number) => Promise<void>
  /** 改筛选条件后回到第一页再取数。 */
  reloadFromFirstPage: () => Promise<void>
}

/**
 * @param fetcher 按当前页码与页大小取一页数据
 * @param initialSize 初始每页条数
 */
export function useAsyncList<TItem>(
  fetcher: (query: AsyncListPage) => Promise<Page<TItem>>,
  initialSize = 20,
): AsyncList<TItem> {
  const items = shallowRef<TItem[]>([])
  const total = ref(0)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const page = ref(1)
  const size = ref(initialSize)

  let sequence = 0

  async function reload(): Promise<void> {
    const mine = ++sequence
    loading.value = true
    error.value = null
    try {
      const result = await fetcher({ page: page.value, size: size.value })
      // 已经有更新的请求发出去了，这一份结果直接丢弃
      if (mine !== sequence) return
      items.value = result.items
      total.value = result.total
    } catch (caught) {
      if (mine !== sequence) return
      error.value = describeError(caught)
      items.value = []
      total.value = 0
    } finally {
      if (mine === sequence) loading.value = false
    }
  }

  async function goToPage(next: number): Promise<void> {
    if (next === page.value) return
    page.value = next
    await reload()
  }

  async function setSize(next: number): Promise<void> {
    if (next === size.value) return
    size.value = next
    // ⚠ 必须回第一页：在第 9 页把每页条数从 10 改成 100，原来的页码会落到
    // 一个空页上，用户看到的是「数据没了」。
    page.value = 1
    await reload()
  }

  async function reloadFromFirstPage(): Promise<void> {
    page.value = 1
    await reload()
  }

  const pager = computed<DtPaginationState>(() => ({
    page: page.value,
    size: size.value,
    total: total.value,
  }))

  return {
    items,
    total,
    loading,
    error,
    pager,
    reload,
    goToPage,
    setSize,
    reloadFromFirstPage,
  }
}
