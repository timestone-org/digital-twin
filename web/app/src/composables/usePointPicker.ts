/** @fileoverview 配置挑点状态：关键词列表与助手同源的语义候选，统一防竞态。 */
import { computed, ref, type Ref } from 'vue'
import type {
  CollectPoint,
  CollectSource,
  DtSelectOption,
  Page,
  PointMatchesOut,
  PointMatchOut,
} from '@dt/contracts'
import { BizError } from '@/api/client'
import { listPoints, listSources } from '@/api/collect'
import { searchCollectPoints, resolveCollectPoint } from '@/api/collectSearch'
import { describeError } from '@/composables/useAsyncList'
import { useRacedFetch, type RacedFetch } from '@/composables/useRacedFetch'
import { protocolLabel } from '@/features/collect/protocols'

export const POINT_PICKER_PAGE_SIZE = 50
const SOURCE_PAGE_SIZE = 200
export const ANY_SOURCE = ''
export type PointPicker = ReturnType<typeof usePointPicker>

/** 数据源筛选与名称；清单失败不阻断点位搜索。 */
function useSourceList() {
  const sources = ref<readonly CollectSource[]>([])
  const sourceError = ref<string | null>(null)
  async function loadSources(): Promise<void> {
    sourceError.value = null
    try {
      sources.value = (await listSources({ size: SOURCE_PAGE_SIZE })).items
    } catch (caught) {
      sources.value = []
      sourceError.value = describeError(caught)
    }
  }
  return {
    sourceError,
    loadSources,
    sourceOptions: computed<DtSelectOption[]>(() => [
      { value: ANY_SOURCE, label: '全部数据源' },
      ...sources.value.map((one) => ({
        value: one.id,
        label: `${one.name} · ${protocolLabel(one.protocol)}`,
      })),
    ]),
    sourceName: (id: string) =>
      sources.value.find((one) => one.id === id)?.name ?? '',
  }
}

function searchState(initialSemantic: boolean) {
  return {
    semantic: ref(initialSemantic),
    keyword: ref(''),
    sourceId: ref(ANY_SOURCE),
    matches: ref<PointMatchesOut | null>(null),
    items: ref<CollectPoint[]>([]),
    total: ref(0),
    loading: ref(false),
    error: ref<string | null>(null),
  }
}
type SearchState = ReturnType<typeof searchState>

/** 非空描述走语义检索，空查询仍浏览点位列表。 */
function fetchPoints(
  state: SearchState,
  signal: AbortSignal,
): Promise<Page<CollectPoint> | PointMatchesOut> {
  const q = state.keyword.value.trim() || undefined
  const sourceId = state.sourceId.value || undefined
  if (state.semantic.value && q) {
    if (q.length > 300)
      throw new BizError(40001, '点位描述请控制在300字以内', 400, '')
    return searchCollectPoints(q, sourceId, signal)
  }
  return listPoints(
    { q, sourceId, page: 1, size: POINT_PICKER_PAGE_SIZE },
    signal,
  )
}

async function search(state: SearchState, raced: RacedFetch): Promise<void> {
  state.loading.value = true
  state.error.value = null
  state.matches.value = null
  state.total.value = 0
  await raced.run((signal) => fetchPoints(state, signal), {
    ok: (page) => {
      if ('mode' in page) {
        state.matches.value = page
        state.items.value = []
      } else {
        state.items.value = page.items
        state.total.value = page.total
      }
    },
    fail: (caught) => {
      state.error.value = describeError(caught)
      state.items.value = []
    },
    settled: () => {
      state.loading.value = false
    },
  })
}

/** 选中候选时读取真实配置；关闭或重搜后不再回填。 */
function usePointSelection(error: Ref<string | null>) {
  const selecting = ref(false)
  const raced = useRacedFetch()
  async function resolve(
    point: CollectPoint | PointMatchOut,
  ): Promise<CollectPoint | null> {
    if ('address' in point) return point
    selecting.value = true
    error.value = null
    let selected: CollectPoint | null = null
    await raced.run((signal) => resolveCollectPoint(point, signal), {
      ok: (result) => {
        selected = result
      },
      fail: (caught) => {
        error.value = describeError(caught)
      },
      settled: () => {
        selecting.value = false
      },
    })
    return selected
  }
  return {
    selecting,
    resolve,
    cancel: () => {
      raced.cancel()
      selecting.value = false
    },
  }
}

export function usePointPicker(initialSemantic = false) {
  const state = searchState(initialSemantic)
  const raced = useRacedFetch()
  const selection = usePointSelection(state.error)
  return {
    ...state,
    ...useSourceList(),
    selecting: selection.selecting,
    resolve: selection.resolve,
    hasMore: computed(() => state.total.value > state.items.value.length),
    search: () => {
      selection.cancel()
      return search(state, raced)
    },
    dispose: () => {
      raced.cancel()
      selection.cancel()
    },
  }
}
