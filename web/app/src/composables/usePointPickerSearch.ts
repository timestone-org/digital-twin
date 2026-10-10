/** @fileoverview 点位选择的列表、语义候选和逐批扩展搜索，统一防竞态。 */
import { computed, ref, type Ref } from 'vue'
import type { CollectPoint, Page, PointMatchesOut } from '@dt/contracts'
import { BizError } from '@/api/client'
import { listPoints } from '@/api/collect'
import { searchCollectPoints } from '@/api/collectSearch'
import { describeError } from '@/composables/useAsyncList'
import { useRacedFetch, type RacedFetch } from '@/composables/useRacedFetch'

export const POINT_PICKER_PAGE_SIZE = 50
const POINT_MATCH_BATCH_SIZE = 20
const MAX_POINT_MATCHES = 100

interface PointQuery {
  q: string | undefined
  sourceId: string | undefined
  semantic: boolean
}

interface SearchResults {
  limit: Ref<number>
  query: PointQuery | null
}

function searchState(initialSemantic: boolean) {
  return {
    semantic: ref(initialSemantic),
    keyword: ref(''),
    sourceId: ref(''),
    matches: ref<PointMatchesOut | null>(null),
    items: ref<CollectPoint[]>([]),
    total: ref(0),
    loading: ref(false),
    error: ref<string | null>(null),
  }
}
type SearchState = ReturnType<typeof searchState>

function readQuery(state: SearchState): PointQuery {
  return {
    q: state.keyword.value.trim() || undefined,
    sourceId: state.sourceId.value || undefined,
    semantic: state.semantic.value,
  }
}

/** 非空描述走语义检索，空查询仍浏览点位列表。 */
function fetchPoints(
  query: PointQuery,
  limit: number,
  signal: AbortSignal,
): Promise<Page<CollectPoint> | PointMatchesOut> {
  const { q, sourceId, semantic } = query
  if (semantic && q) {
    if (q.length > 300)
      throw new BizError(40001, '点位描述请控制在300字以内', 400, '')
    return searchCollectPoints(q, sourceId, signal, limit)
  }
  return listPoints(
    { q, sourceId, page: 1, size: POINT_PICKER_PAGE_SIZE },
    signal,
  )
}

async function search(
  state: SearchState,
  results: SearchResults,
  raced: RacedFetch,
  query: PointQuery,
  limit: number,
): Promise<void> {
  state.loading.value = true
  state.error.value = null
  if (limit === POINT_MATCH_BATCH_SIZE) {
    state.matches.value = null
    state.items.value = []
    state.total.value = 0
    results.limit.value = POINT_MATCH_BATCH_SIZE
    results.query = null
  }
  await raced.run((signal) => fetchPoints(query, limit, signal), {
    ok: (page) => {
      if ('mode' in page) {
        state.matches.value = page
        results.limit.value = limit
        results.query = query
      } else {
        state.items.value = page.items
        state.total.value = page.total
      }
    },
    fail: (caught) => {
      state.error.value = describeError(caught)
    },
    settled: () => {
      state.loading.value = false
    },
  })
}

export function usePointPickerSearch(initialSemantic: boolean) {
  const state = searchState(initialSemantic)
  const raced = useRacedFetch()
  const results: SearchResults = {
    limit: ref(POINT_MATCH_BATCH_SIZE),
    query: null,
  }
  const isResultFull = computed(
    () => (state.matches.value?.items.length ?? 0) >= results.limit.value,
  )
  const canLoadMore = computed(
    () => isResultFull.value && results.limit.value < MAX_POINT_MATCHES,
  )

  return {
    ...state,
    canLoadMore,
    isSearchLimitReached: computed(
      () => isResultFull.value && results.limit.value === MAX_POINT_MATCHES,
    ),
    hasMore: computed(() => state.total.value > state.items.value.length),
    search: () =>
      search(state, results, raced, readQuery(state), POINT_MATCH_BATCH_SIZE),
    loadMore: () => {
      if (state.loading.value || !canLoadMore.value || results.query === null)
        return Promise.resolve()
      return search(
        state,
        results,
        raced,
        results.query,
        Math.min(
          results.limit.value + POINT_MATCH_BATCH_SIZE,
          MAX_POINT_MATCHES,
        ),
      )
    },
    dispose: () => {
      raced.cancel()
      state.loading.value = false
    },
  }
}
