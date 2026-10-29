/** @fileoverview 能管名称与系统筛选、单页读取及快速切换的竞态保护。 */
import type { ModelingBdmCatalog, ModelingBdmSystems } from '@dt/contracts'
import type { Ref } from 'vue'
import { computed, onScopeDispose, ref, watch } from 'vue'

import { listModelingBdmCatalog, listModelingBdmSystems } from '@/api/modeling'
import { describeError } from '@/composables/useAsyncList'
import { useRacedFetch } from '@/composables/useRacedFetch'

type Kind = ModelingBdmCatalog['kind']
interface CatalogState {
  page: Ref<number>
  name: Ref<string>
  searchBy: Ref<string>
  system: Ref<string>
  appliedName: Ref<string>
  appliedSearchBy: Ref<string>
  appliedSystem: Ref<string>
  result: Ref<ModelingBdmCatalog | null>
  isLoading: Ref<boolean>
  error: Ref<string>
}

function watchCatalogPages(
  kind: () => Kind,
  state: CatalogState,
  load: () => Promise<void>,
): void {
  watch(
    [kind, state.page],
    ([nextKind], [previousKind]) => {
      if (nextKind !== previousKind) {
        state.name.value = ''
        state.searchBy.value = 'name'
        state.system.value = ''
        state.appliedName.value = ''
        state.appliedSearchBy.value = 'name'
        state.appliedSystem.value = ''
        if (state.page.value !== 1) {
          state.page.value = 1
          return
        }
      }
      void load()
    },
    { immediate: true },
  )
}

async function loadCatalog(
  kind: Kind,
  state: CatalogState,
  raced: ReturnType<typeof useRacedFetch>,
): Promise<void> {
  state.isLoading.value = true
  state.error.value = ''
  state.result.value = null
  await raced.run(
    (signal) =>
      listModelingBdmCatalog(
        {
          kind,
          page: state.page.value,
          ...searchFilter(kind, state),
          system: state.appliedSystem.value,
        },
        signal,
      ),
    {
      ok: (value) => {
        state.result.value = value
      },
      fail: (caught) => {
        state.error.value = describeError(caught)
      },
      settled: () => {
        state.isLoading.value = false
      },
    },
  )
}

function searchFilter(kind: Kind, state: CatalogState) {
  const value = state.appliedName.value
  if (kind === 'point' && state.appliedSearchBy.value === 'code')
    return { code: value }
  if (kind === 'point' && state.appliedSearchBy.value === 'keyword')
    return { keyword: value }
  return { name: value }
}

function usePointSystems(kind: () => Kind) {
  const result = ref<ModelingBdmSystems | null>(null)
  const error = ref('')
  const isLoading = ref(false)
  const raced = useRacedFetch()
  async function load(): Promise<void> {
    raced.cancel()
    result.value = null
    error.value = ''
    isLoading.value = kind() === 'point'
    if (!isLoading.value) return
    await raced.run(listModelingBdmSystems, {
      ok: (value) => {
        result.value = value
      },
      fail: (caught) => {
        error.value = describeError(caught)
      },
      settled: () => {
        isLoading.value = false
      },
    })
  }
  watch(kind, () => void load(), { immediate: true })
  onScopeDispose(() => raced.cancel())
  return { result, error, isLoading, load }
}

export function useBdmCatalog(kind: () => Kind) {
  const state: CatalogState = {
    page: ref(1),
    name: ref(''),
    searchBy: ref('name'),
    system: ref(''),
    appliedName: ref(''),
    appliedSearchBy: ref('name'),
    appliedSystem: ref(''),
    result: ref<ModelingBdmCatalog | null>(null),
    isLoading: ref(false),
    error: ref(''),
  }
  const raced = useRacedFetch()
  const systems = usePointSystems(kind)
  const load = () => loadCatalog(kind(), state, raced)
  watchCatalogPages(kind, state, load)
  onScopeDispose(() => raced.cancel())
  function search(): void {
    state.appliedName.value = state.name.value.trim()
    state.appliedSearchBy.value = state.searchBy.value
    state.appliedSystem.value = state.system.value.trim()
    if (state.page.value === 1) void load()
    else state.page.value = 1
  }
  return {
    ...state,
    load,
    search,
    refresh: load,
    loadSystems: systems.load,
    systemsError: systems.error,
    systemsLoading: systems.isLoading,
    systemCapability: computed(
      () => systems.result.value?.system_filter_available ?? null,
    ),
    systemOptions: computed(() => [
      { value: '', label: '全部系统' },
      ...(systems.result.value?.items ?? []).map((value) => ({
        value,
        label: value,
      })),
    ]),
    items: computed(() => state.result.value?.items ?? []),
    total: computed(() => state.result.value?.total ?? 0),
    hasResult: computed(() => state.result.value !== null),
  }
}
