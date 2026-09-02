/**
 * @fileoverview 知识库页的状态与两个公共动作：出错怎么说、文档怎么重取。
 *
 * ⚠ 每一次切库都要**防竞态**：用户点得快时，先发的那次请求可能后回来，
 * 于是右边显示的是上一个库的文档，而两边看着都正常。防护走统一的
 * `useRacedFetch`——手搓一份序号的话，漏掉某条路径不会有任何报错。
 */
import { computed, getCurrentScope, onScopeDispose, ref, shallowRef } from 'vue'

import { listDocuments } from '@/api/knowledge'
import type {
  KnowledgeBase,
  KnowledgeCapability,
  KnowledgeDocument,
  KnowledgeSearchResult,
} from '@/api/knowledge'
import { useRacedFetch } from '@/composables/useRacedFetch'

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
  const documentsRace = useRacedFetch()

  const selected = computed<KnowledgeBase | null>(
    () => bases.value.find((one) => one.id === selectedId.value) ?? null,
  )
  const accept = computed(() =>
    (capability.value?.acceptedSuffixes ?? []).join(','),
  )
  const indexHint = computed(() => capability.value?.index.reason ?? '')

  // ⚠ 离开这一页要作废在飞的那一次：不作废的话，之后才返回的那一次照样会写进
  // 一个已经没人看的状态，请求本身也白占一条连接
  if (getCurrentScope() !== undefined) {
    onScopeDispose(() => {
      documentsRace.cancel()
    })
  }

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
    documentsRace,
    selected,
    accept,
    indexHint,
  }
}

/** 页面状态的类型。 */
export type KnowledgeState = ReturnType<typeof createState>

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
