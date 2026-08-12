/**
 * @fileoverview 游标翻页：首屏替换、「加载更多」追加。
 *
 * ⚠ 游标是**不透明串**，只能把上一页响应里的 `next` 原样带回去；解析它等于把
 * 后端的分页实现钉死在前端。
 * ⚠ 首屏与追加共用一个竞态序号，这是刻意的：两者写的是同一份列表，换了筛选之后
 * 上一段的「下一页」再回来就该被丢掉——它接的是另一份结果的尾巴。
 */
import { ref, shallowRef, type Ref } from 'vue'
import type { CursorPage } from '@dt/contracts'

import { useRacedFetch, type RacedFetch } from '@/composables/useRacedFetch'

export interface CursorList<TItem, TProblem> {
  items: Ref<TItem[]>
  /** 首屏取数中。追加时不置位，否则整张表会闪成骨架。 */
  loading: Ref<boolean>
  loadingMore: Ref<boolean>
  hasMore: Ref<boolean>
  problem: Ref<TProblem | null>
  reload: () => Promise<void>
  loadMore: () => Promise<void>
}

interface ListState<TItem, TProblem> {
  fetcher: (after: string | null) => Promise<CursorPage<TItem>>
  describe: (caught: unknown) => TProblem
  items: Ref<TItem[]>
  loading: Ref<boolean>
  loadingMore: Ref<boolean>
  hasMore: Ref<boolean>
  cursor: Ref<string | null>
  problem: Ref<TProblem | null>
  raced: RacedFetch
}

/**
 * @param fetcher 按游标取一页；`null` 表示取第一页
 * @param describe 把失败翻成调用方要显示的形状——各页对错误的分诊口径不同
 */
export function useCursorList<TItem, TProblem>(
  fetcher: (after: string | null) => Promise<CursorPage<TItem>>,
  describe: (caught: unknown) => TProblem,
): CursorList<TItem, TProblem> {
  const state: ListState<TItem, TProblem> = {
    fetcher,
    describe,
    // 一次能攒到几千行，深层代理没有收益；同 useAsyncList
    items: shallowRef<TItem[]>([]),
    loading: ref(false),
    loadingMore: ref(false),
    hasMore: ref(false),
    cursor: ref<string | null>(null),
    problem: ref<TProblem | null>(null) as Ref<TProblem | null>,
    raced: useRacedFetch(),
  }
  return {
    items: state.items,
    loading: state.loading,
    loadingMore: state.loadingMore,
    hasMore: state.hasMore,
    problem: state.problem,
    reload: () => reload(state),
    loadMore: () => loadMore(state),
  }
}

function accept<TItem, TProblem>(
  state: ListState<TItem, TProblem>,
  page: CursorPage<TItem>,
  append: boolean,
): void {
  state.items.value = append
    ? [...state.items.value, ...page.items]
    : page.items
  state.cursor.value = page.next
  state.hasMore.value = page.has_more
  state.problem.value = null
}

function fail<TItem, TProblem>(
  state: ListState<TItem, TProblem>,
  caught: unknown,
): void {
  state.problem.value = state.describe(caught)
  state.items.value = []
  state.hasMore.value = false
  state.cursor.value = null
}

async function reload<TItem, TProblem>(
  state: ListState<TItem, TProblem>,
): Promise<void> {
  state.loading.value = true
  await state.raced.run(() => state.fetcher(null), {
    ok: (page) => accept(state, page, false),
    fail: (caught) => fail(state, caught),
    settled: () => {
      state.loading.value = false
      state.loadingMore.value = false
    },
  })
}

/** 没有下一页、或正在取数时不重复发起。 */
async function loadMore<TItem, TProblem>(
  state: ListState<TItem, TProblem>,
): Promise<void> {
  const after = state.cursor.value
  if (after === null || state.loading.value || state.loadingMore.value) return
  state.loadingMore.value = true
  await state.raced.run(() => state.fetcher(after), {
    ok: (page) => accept(state, page, true),
    fail: (caught) => fail(state, caught),
    settled: () => (state.loadingMore.value = false),
  })
}
