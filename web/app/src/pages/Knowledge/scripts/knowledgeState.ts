/**
 * @fileoverview 知识库页的状态与两个公共动作：出错怎么说、文档怎么重取。
 *
 * ⚠ 每一次切库都要**防竞态**：用户点得快时，先发的那次请求可能后回来，
 * 于是右边显示的是上一个库的文档，而两边看着都正常。防护走统一的
 * `useRacedFetch`——手搓一份序号的话，漏掉某条路径不会有任何报错。
 */
import { computed, getCurrentScope, onScopeDispose, ref, shallowRef } from 'vue'
import type { Ref } from 'vue'

import { listBases, listDocuments, readBase } from '@/api/knowledge'
import type {
  KnowledgeBase,
  KnowledgeCapability,
  KnowledgeDocument,
  KnowledgeSearchResult,
} from '@/api/knowledge'
import { useRacedFetch } from '@/composables/useRacedFetch'
import type { RacedFetch } from '@/composables/useRacedFetch'

/** 一次上传的进度（0–1）。总字节为 0 时浏览器给不出长度。 */
export interface UploadState {
  name: string
  ratio: number
}

/** 页面手上的全部状态。 */
export function createState() {
  const bases = shallowRef<KnowledgeBase[]>([])
  const documents = shallowRef<KnowledgeDocument[]>([])
  const capability = shallowRef<KnowledgeCapability | null>(null)
  const result = shallowRef<KnowledgeSearchResult | null>(null)
  const upload = shallowRef<UploadState | null>(null)
  const selectedId = ref('')
  const query = ref('')
  const searched = ref('')
  const error = ref('')
  const isLoading = ref(false)
  const isRefreshing = ref(false)
  const isSearching = ref(false)
  const isDisposed = ref(false)
  const races = createRaces(isDisposed)

  const selected = computed<KnowledgeBase | null>(
    () => bases.value.find((one) => one.id === selectedId.value) ?? null,
  )
  const accept = computed(() =>
    (capability.value?.acceptedSuffixes ?? []).join(','),
  )
  const indexHint = computed(() => capability.value?.index.reason ?? '')

  return {
    bases,
    documents,
    capability,
    result,
    upload,
    selectedId,
    query,
    searched,
    error,
    isLoading,
    isRefreshing,
    isSearching,
    isDisposed,
    ...races,
    selected,
    accept,
    indexHint,
  }
}

function createRaces(isDisposed: Ref<boolean>) {
  const races = {
    documentsRace: useRacedFetch(),
    searchesRace: useRacedFetch(),
    countsRace: useRacedFetch(),
    reloadRace: useRacedFetch(),
  }
  cancelOnDispose(isDisposed, Object.values(races))
  return races
}

function cancelOnDispose(
  isDisposed: Ref<boolean>,
  races: readonly RacedFetch[],
): void {
  if (getCurrentScope() === undefined) return
  onScopeDispose(() => {
    isDisposed.value = true
    races.forEach((race) => race.cancel())
  })
}

/** 页面状态的类型。 */
export type KnowledgeState = ReturnType<typeof createState>

export function cancelSearch(state: KnowledgeState): void {
  state.searchesRace.cancel()
  state.result.value = null
  state.searched.value = ''
  state.isSearching.value = false
}

/**
 * 跑一个动作，出错时把**后端那句原话**显示出来；跑完没炸才回 true。
 *
 * ⚠ 换成一句笼统的「操作失败」等于把唯一有用的信息扔掉：后端那句是写给最终
 * 用户的（「这份内容已经在这个库里了」「这个库还没建索引」）。
 * @param state 页面状态
 * @param run 要跑的动作
 */
export async function guarded(
  state: KnowledgeState,
  run: () => Promise<void>,
): Promise<boolean> {
  state.error.value = ''
  try {
    await run()
    return true
  } catch (cause) {
    state.error.value = messageOf(cause)
    return false
  }
}

/**
 * 一个异常里有没有一句能给人看的话。
 * @param cause 抓到的东西
 */
export function messageOf(cause: unknown): string {
  return cause instanceof Error && cause.message !== ''
    ? cause.message
    : '操作失败，请重试'
}

/**
 * 重取当前库的文档。
 * @param state 页面状态
 */
export async function refreshDocuments(state: KnowledgeState): Promise<void> {
  const baseId = state.selectedId.value
  if (baseId === '') {
    state.documentsRace.cancel()
    state.documents.value = []
    state.isRefreshing.value = false
    return
  }
  state.isRefreshing.value = true
  // ⚠ 慢回来的那一次由 `useRacedFetch` 丢掉：不丢的话，右边显示的是上一个库
  // 的文档，而两边看着都正常
  await state.documentsRace.run((signal) => listDocuments(baseId, signal), {
    ok: (rows) => {
      state.documents.value = rows
    },
    fail: (cause) => {
      state.error.value = messageOf(cause)
    },
    settled: () => {
      state.isRefreshing.value = false
    },
  })
}

/** 重取文档与服务端库统计，保留选库及新建、删除后的本地清单。 */
export async function refreshLibrary(
  state: KnowledgeState,
  changedIds: readonly string[] = [],
): Promise<void> {
  if (state.isDisposed.value) return
  if (state.isLoading.value && changedIds.length === 0) return
  state.error.value = ''
  await Promise.all([refreshDocuments(state), refreshCounts(state, changedIds)])
}

async function refreshCounts(
  state: KnowledgeState,
  changedIds: readonly string[],
): Promise<void> {
  const ids = [...new Set([state.selectedId.value, ...changedIds])].filter(
    (id) => id !== '',
  )
  if (ids.length === 0) return
  await state.countsRace.run((signal) => readCounts(ids, signal), {
    ok: (rows) => {
      const counts = new Map(rows.map((one) => [one.id, one.documentCount]))
      state.bases.value = state.bases.value.map((base) => {
        const count = counts.get(base.id)
        return count === undefined ? base : { ...base, documentCount: count }
      })
    },
    fail: (cause) => {
      state.error.value = `文档数未刷新：${messageOf(cause)}`
    },
    settled: () => {},
  })
}

async function readCounts(
  ids: readonly string[],
  signal: AbortSignal,
): Promise<KnowledgeBase[]> {
  const rows: KnowledgeBase[] = []
  for (const id of ids) {
    signal.throwIfAborted()
    rows.push(await readBase(id, signal))
  }
  return rows
}

/** 整体重载与文档写后统计共用竞态守卫，旧清单不能覆盖新计数。 */
export async function refreshBases(state: KnowledgeState): Promise<void> {
  const selectedId = state.selectedId.value
  await readBases(state, selectedId === '' ? [] : [selectedId], (rows) => {
    const current = state.selected.value
    if (current !== null && !rows.some((base) => base.id === current.id)) {
      state.bases.value = [...rows, current]
      state.error.value = '选中库文档数未刷新，请重试'
    } else {
      state.bases.value = rows
    }
  })
}

async function readBases(
  state: KnowledgeState,
  requiredIds: readonly string[],
  accept: (rows: KnowledgeBase[]) => void,
): Promise<void> {
  if (state.isDisposed.value) return
  await state.countsRace.run(
    (signal) => readVisibleBases(requiredIds, signal),
    {
      ok: accept,
      fail: (cause) => {
        state.error.value = `文档数未刷新：${messageOf(cause)}`
      },
      settled: () => {},
    },
  )
}

/** 列表页外只补读已显示的有限ID；同一次取消中止余下串行请求。 */
async function readVisibleBases(
  requiredIds: readonly string[],
  signal: AbortSignal,
): Promise<KnowledgeBase[]> {
  const rows = [...(await listBases(signal))]
  const included = new Set(rows.map((base) => base.id))
  for (const id of new Set(requiredIds)) {
    if (included.has(id)) continue
    signal.throwIfAborted()
    rows.push(await readBase(id, signal))
  }
  return rows
}
