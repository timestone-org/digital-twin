/** @fileoverview 协议采集页的数据源查询、选中详情与运行态轮询。 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { CollectProtocol, CollectSource, Page } from '@dt/contracts'

import { BizError } from '@/api/client'
import * as collect from '@/api/collect'
import { describeError } from '@/composables/useAsyncList'
import { useRacedFetch, type RacedFetch } from '@/composables/useRacedFetch'
import { COLLECT_PROTOCOL_PAGES } from '@/features/collect/protocols'
import { useActiveSource, type ActiveSource } from './useActiveSource'

const REFRESH_MS = 10_000
export const SOURCE_LIST_SIZE = 100

interface SourcePage extends Page<CollectSource> {
  detail: CollectSource | null
}

interface SourceListContext {
  protocol: CollectProtocol
  route: ReturnType<typeof useRoute>
  router: ReturnType<typeof useRouter>
  state: ReturnType<typeof createSourceState>
  selection: ActiveSource
  raced: RacedFetch
}

function createSourceState() {
  return {
    sources: ref<CollectSource[]>([]),
    sourcesLoading: ref(false),
    sourcesError: ref<string | null>(null),
    sourceKeyword: ref(''),
    sourceQuery: ref(''),
    sourcePage: ref(1),
    sourceTotal: ref(0),
    selectedDetail: ref<CollectSource | null>(null),
  }
}

async function loadSourcePage(
  query: collect.SourceQuery,
  selectedId: string | null,
): Promise<SourcePage> {
  const page = await collect.listSources(query)
  let detail = page.items.find((one) => one.id === selectedId) ?? null
  if (selectedId !== null && detail === null) {
    try {
      detail = await collect.getSource(selectedId)
    } catch (caught) {
      if (!(caught instanceof BizError && caught.status === 404)) throw caught
    }
  }
  return { ...page, detail }
}

function isCurrentPage(ctx: SourceListContext): boolean {
  return ctx.route.matched.some(
    (record) => record.path === COLLECT_PROTOCOL_PAGES[ctx.protocol].path,
  )
}

function applyPage(
  ctx: SourceListContext,
  page: SourcePage,
  selectedId: string | null,
): void {
  if (!isCurrentPage(ctx)) return
  const { state, selection } = ctx
  const isCurrentSelection = selectedId === selection.activeId.value
  if (
    isCurrentSelection &&
    page.detail !== null &&
    page.detail.protocol !== ctx.protocol
  ) {
    void ctx.router.replace({
      path: COLLECT_PROTOCOL_PAGES[page.detail.protocol].path,
      query: ctx.route.query,
      hash: ctx.route.hash,
    })
    return
  }
  state.sources.value = page.items
  state.sourceTotal.value = page.total
  state.sourcesError.value = null
  if (!isCurrentSelection) return
  state.selectedDetail.value = page.detail
  if (page.detail === null) selection.reconcile(page.items.map((one) => one.id))
}

async function loadSources(ctx: SourceListContext): Promise<void> {
  if (!isCurrentPage(ctx)) return
  const { state } = ctx
  const selectedId = ctx.selection.activeId.value
  state.sourcesLoading.value = true
  await ctx.raced.run(
    () =>
      loadSourcePage(
        {
          protocol: ctx.protocol,
          size: SOURCE_LIST_SIZE,
          page: state.sourcePage.value,
          q: state.sourceQuery.value || undefined,
        },
        selectedId,
      ),
    {
      ok: (page) => applyPage(ctx, page, selectedId),
      fail: (caught) => (state.sourcesError.value = describeError(caught)),
      settled: () => (state.sourcesLoading.value = false),
    },
  )
}

function useSourceRefresh(
  ctx: SourceListContext,
  reload: () => Promise<void>,
): void {
  watch(ctx.selection.activeId, (id) => {
    if (id !== null && !ctx.state.sources.value.some((one) => one.id === id))
      void reload()
  })
  let timer: ReturnType<typeof setInterval> | null = null
  onMounted(() => {
    void reload()
    timer = setInterval(() => void reload(), REFRESH_MS)
  })
  onUnmounted(() => {
    if (timer !== null) clearInterval(timer)
    ctx.raced.cancel()
  })
}

/**
 * 装配固定协议页面的数据源状态，卸载时停止轮询并作废请求。
 * @param protocol 页面入口指定的协议
 */
export function useSourceList(protocol: () => CollectProtocol) {
  const ctx: SourceListContext = {
    protocol: protocol(),
    route: useRoute(),
    router: useRouter(),
    state: createSourceState(),
    selection: useActiveSource(),
    raced: useRacedFetch(),
  }
  const reload = () => loadSources(ctx)
  useSourceRefresh(ctx, reload)
  const { selectedDetail, ...state } = ctx.state
  const { activeId, select } = ctx.selection
  return {
    ...state,
    activeId,
    activeSource: computed(
      () =>
        state.sources.value.find((one) => one.id === activeId.value) ??
        (selectedDetail.value?.id === activeId.value
          ? selectedDetail.value
          : null),
    ),
    selectSource: select,
    loadSources: reload,
    searchSources: () => {
      state.sourceQuery.value = state.sourceKeyword.value.trim()
      state.sourcePage.value = 1
      void reload()
    },
    changeSourcePage: (page: number) => {
      state.sourcePage.value = page
      void reload()
    },
  }
}
