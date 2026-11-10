/**
 * @fileoverview 列表页共用的取数状态机：分页 + 加载中 / 出错 / 数据 + 竞态防护。
 *
 * ⚠ 竞态防护是必须的，不是可选的：筛选条件被快速切换时，慢的那次请求后返回
 * 会覆盖快的那次的结果，界面显示过期数据**且没有任何报错**。
 */

import {
  computed,
  getCurrentScope,
  onScopeDispose,
  ref,
  shallowRef,
  type ComputedRef,
  type Ref,
} from 'vue'
import { ERROR_CODES, type Page } from '@dt/contracts'
import type { DtPaginationState } from '@dt/ui'

import { BizError, TransportError } from '@/api/client'
import { useRacedFetch } from '@/composables/useRacedFetch'

// 参数校验失败时文案里最多列几条字段原因
const SHOWN_FIELD_ERRORS = 3

/**
 * 参数校验失败时把逐字段原因拼在后面。
 * ⚠ 只认通用校验码：别的业务码的 details 各有用途（如删列的引用者），拼进文案会重复。
 * @param caught 业务错误
 */
function withFieldErrors(caught: BizError): string {
  const summary = caught.message || '请求失败'
  if (caught.code !== ERROR_CODES.validationFailed) return summary
  const shown = caught.details
    .slice(0, SHOWN_FIELD_ERRORS)
    .map((item) => `${item.field}：${item.message}`)
  if (shown.length === 0) return summary
  const rest = caught.details.length - shown.length
  return `${summary}：${shown.join('；')}${rest > 0 ? `；另有 ${rest} 项` : ''}`
}

/** 把后端与网络错误归一成一句能给用户看的话。 */
export function describeError(caught: unknown): string {
  if (caught instanceof BizError) return withFieldErrors(caught)
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
  fetcher: (query: AsyncListPage, signal: AbortSignal) => Promise<Page<TItem>>,
  initialSize = 20,
): AsyncList<TItem> {
  const items = shallowRef<TItem[]>([])
  const total = ref(0)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const page = ref(1)
  const size = ref(initialSize)
  const raced = useRacedFetch()
  if (getCurrentScope() !== undefined) onScopeDispose(raced.cancel)

  async function reload(): Promise<void> {
    loading.value = true
    error.value = null
    const task = (signal: AbortSignal): Promise<Page<TItem>> =>
      fetcher({ page: page.value, size: size.value }, signal)
    await raced.run(task, {
      ok: ({ items: rows, total: count }) => {
        items.value = rows
        total.value = count
      },
      // ⚠ 失败时保留总数：清零会让分页器把页码夹回第一页并自己再取一次数
      fail: (caught) => {
        error.value = describeError(caught)
        items.value = []
      },
      settled: () => (loading.value = false),
    })
  }

  const pager = computed<DtPaginationState>(() => ({
    page: page.value,
    size: size.value,
    total: total.value,
  }))
  const state = { items, total, loading, error, pager }
  return { ...state, reload, ...pageActions({ page, size, reload }) }
}

interface PagingRefs {
  page: Ref<number>
  size: Ref<number>
  reload: () => Promise<void>
}

/** 三个翻页动作。它们只改页码与页大小，取数一律交回 `reload`。 */
function pageActions(refs: PagingRefs) {
  return {
    goToPage: async (next: number): Promise<void> => {
      if (next === refs.page.value) return
      refs.page.value = next
      await refs.reload()
    },
    // ⚠ 改每页条数必须回第一页：在第 9 页把每页条数从 10 改成 100，原来的
    // 页码会落到一个空页上，用户看到的是「数据没了」。
    setSize: async (next: number): Promise<void> => {
      if (next === refs.size.value) return
      refs.size.value = next
      refs.page.value = 1
      await refs.reload()
    },
    reloadFromFirstPage: async (): Promise<void> => {
      refs.page.value = 1
      await refs.reload()
    },
  }
}
