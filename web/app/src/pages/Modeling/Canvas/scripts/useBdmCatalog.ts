/** @fileoverview BDM 单页目录加载、查询和快速切换的竞态保护。 */
import type { ModelingBdmCatalog } from '@dt/contracts'
import type { Ref } from 'vue'
import { computed, onScopeDispose, ref, watch } from 'vue'

import { listModelingBdmCatalog } from '@/api/modeling'
import { describeError } from '@/composables/useAsyncList'
import { useRacedFetch } from '@/composables/useRacedFetch'
import {
  BdmCatalogSearchError,
  createBdmCatalogReader,
} from './bdmCatalogSearch'
import type { BdmSearchProgress } from './bdmCatalogSearch'

function watchCatalogPages(
  kind: () => ModelingBdmCatalog['kind'],
  page: Ref<number>,
  state: CatalogState,
  load: () => Promise<void>,
): void {
  watch(
    [kind, page],
    ([nextKind], [previousKind]) => {
      if (nextKind !== previousKind) {
        state.keyword.value = ''
        state.appliedKeyword.value = ''
        if (page.value !== 1) {
          page.value = 1
          return
        }
      }
      void load()
    },
    { immediate: true },
  )
}

interface CatalogState {
  page: Ref<number>
  keyword: Ref<string>
  appliedKeyword: Ref<string>
  result: Ref<ModelingBdmCatalog | null>
  isLoading: Ref<boolean>
  error: Ref<string>
  progress: Ref<BdmSearchProgress | null>
}

async function loadCatalog(
  kind: ModelingBdmCatalog['kind'],
  state: CatalogState,
  raced: ReturnType<typeof useRacedFetch>,
  reader: ReturnType<typeof createBdmCatalogReader>,
): Promise<void> {
  state.isLoading.value = true
  state.error.value = ''
  state.result.value = null
  state.progress.value = null
  await raced.run(
    (signal) =>
      reader.read(
        {
          kind,
          page: state.page.value,
          keyword: state.appliedKeyword.value,
        },
        signal,
        (value) => {
          if (!signal.aborted) state.progress.value = value
        },
      ),
    {
      ok: (value) => {
        state.result.value = value
      },
      fail: (caught) => {
        state.error.value =
          caught instanceof BdmCatalogSearchError
            ? caught.message
            : describeError(caught)
      },
      settled: () => {
        state.isLoading.value = false
      },
    },
  )
}

export function useBdmCatalog(kind: () => ModelingBdmCatalog['kind']) {
  const state: CatalogState = {
    page: ref(1),
    keyword: ref(''),
    appliedKeyword: ref(''),
    result: ref<ModelingBdmCatalog | null>(null),
    isLoading: ref(false),
    error: ref(''),
    progress: ref<BdmSearchProgress | null>(null),
  }
  const raced = useRacedFetch()
  const reader = createBdmCatalogReader(listModelingBdmCatalog)
  const load = () => loadCatalog(kind(), state, raced, reader)
  watchCatalogPages(kind, state.page, state, load)
  onScopeDispose(() => raced.cancel())
  function search(): void {
    state.appliedKeyword.value = state.keyword.value.trim()
    if (state.page.value === 1) void load()
    else state.page.value = 1
  }
  return {
    ...state,
    load,
    search,
    refresh: () => {
      reader.clear(kind())
      void load()
    },
    items: computed(() => state.result.value?.items ?? []),
    total: computed(() => state.result.value?.total ?? 0),
    hasResult: computed(() => state.result.value !== null),
  }
}
