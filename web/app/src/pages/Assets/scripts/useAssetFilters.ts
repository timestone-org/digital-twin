/** @fileoverview 同步素材库筛选与地址栏，搜索输入按现有节奏防抖。 */
import { ASSET_KINDS, type AssetKind } from '@dt/contracts'
import { onMounted, onUnmounted, ref, watch, type Ref } from 'vue'
import {
  useRoute,
  useRouter,
  type LocationQuery,
  type RouteLocationNormalizedLoaded,
  type Router,
} from 'vue-router'

import type { AssetLibrary } from '@/features/assets/useAssetLibrary'

const SEARCH_DEBOUNCE_MS = 300

export interface AssetFilters {
  kind: Ref<AssetKind>
  draftKeyword: Ref<string>
  selectKind: (next: string) => void
  typeKeyword: (text: string) => void
}

interface FilterSelection {
  kind: AssetKind
  keyword: string
}

/** 从共享地址读取有效筛选。 @param query 路由参数 */
function readSelection(query: LocationQuery): FilterSelection {
  return {
    kind: ASSET_KINDS.find((item) => item === query.kind) ?? 'image',
    keyword: typeof query.q === 'string' ? query.q.trim() : '',
  }
}

/**
 * 更新筛选地址，保留同页的其他参数。
 * @param route 当前路由
 * @param router 路由操作
 * @param selection 素材筛选
 */
function writeSelection(
  route: RouteLocationNormalizedLoaded,
  router: Router,
  selection: FilterSelection,
): void {
  if (route.name !== 'assets') return
  const query = { ...route.query }
  if (selection.kind === 'image') delete query.kind
  else query.kind = selection.kind
  if (selection.keyword === '') delete query.q
  else query.q = selection.keyword
  void router.replace({ query })
}

/** 同步素材库的类型和搜索词。 @param library 当前素材库 */
export function useAssetFilters(
  library: Pick<AssetLibrary, 'reload' | 'keyword'>,
): AssetFilters {
  const route = useRoute()
  const router = useRouter()
  const initial = readSelection(route.query)
  const kind = ref(initial.kind)
  const draftKeyword = ref(initial.keyword)
  let debounce: ReturnType<typeof setTimeout> | null = null

  function cancelSearch(): void {
    if (debounce !== null) clearTimeout(debounce)
    debounce = null
  }

  function apply(selection: FilterSelection): void {
    if (route.name !== 'assets') return
    kind.value = selection.kind
    void library.reload(selection.kind, selection.keyword)
    writeSelection(route, router, selection)
  }

  function selectKind(next: string): void {
    const found = ASSET_KINDS.find((item) => item === next)
    if (found === undefined || found === kind.value) return
    cancelSearch()
    apply({ kind: found, keyword: draftKeyword.value.trim() })
  }

  function typeKeyword(text: string): void {
    draftKeyword.value = text
    cancelSearch()
    debounce = setTimeout(() => {
      debounce = null
      apply({ kind: kind.value, keyword: text.trim() })
    }, SEARCH_DEBOUNCE_MS)
  }

  watch([() => route.name, () => route.query], () => {
    if (route.name !== 'assets') return cancelSearch()
    const selection = readSelection(route.query)
    if (
      selection.kind === kind.value &&
      selection.keyword === library.keyword.value
    )
      return
    cancelSearch()
    kind.value = selection.kind
    draftKeyword.value = selection.keyword
    void library.reload(selection.kind, selection.keyword)
  })

  onMounted(() => void library.reload(initial.kind, initial.keyword))
  onUnmounted(cancelSearch)
  return { kind, draftKeyword, selectKind, typeKeyword }
}
