/**
 * @fileoverview 知识库对话页的状态，以及「切到某个对话就回放它的历史」这一步。
 *
 * ⚠ 切对话要**防竞态**：连点两个对话时，先发的那次读取可能后回来，于是时间线上
 * 是上一个对话的历史而标题是这一个的。走统一的 `useRacedFetch`。
 */
import { computed, getCurrentScope, onScopeDispose, ref, shallowRef } from 'vue'
import type {
  KnowledgeChatScopeBase,
  KnowledgeChatSession,
} from '@dt/contracts'

import type { KnowledgeBase } from '@/api/knowledge'
import { readSession } from '@/api/knowledgeChat'
import { useRacedFetch } from '@/composables/useRacedFetch'
import {
  useKnowledgeConversation,
  type KnowledgeConversation,
} from '@/composables/useKnowledgeConversation'
import { scopeOfIds } from './chatScope'

/** 页面手上的全部状态。 */
export function createState(chat?: KnowledgeConversation) {
  const sessions = shallowRef<KnowledgeChatSession[]>([])
  const selectedId = ref<string | null>(null)
  const error = ref('')
  const isLoading = ref(false)
  /** 这套部署接了语音识别。取不到当 false，只是少一枚麦克风键，不挡对话。 */
  const isAsrEnabled = ref(false)
  /** 可选的知识库，给范围选择器用。取不到就只剩「全部」一项，不挡对话。 */
  const bases = shallowRef<KnowledgeBase[]>([])
  /**
   * 还没选中会话时先记在这的范围；建会话那一刻带上去。
   * ⚠ null = 全部知识库，与「一个都没选」不是一回事。
   */
  const pendingScope = ref<string[] | null>(null)
  const replayRace = useRacedFetch()
  const conversation = chat ?? useKnowledgeConversation(() => selectedId.value)

  if (getCurrentScope() !== undefined) {
    onScopeDispose(() => {
      replayRace.cancel()
    })
  }

  const current = computed<KnowledgeChatSession | null>(
    () => sessions.value.find((one) => one.id === selectedId.value) ?? null,
  )
  /** 此刻这一页在用的范围：选中了会话就是它的，没选就是暂存的那份。 */
  const scope = computed<KnowledgeChatScopeBase[] | null>(() =>
    current.value === null
      ? scopeOfIds(pendingScope.value, bases.value)
      : current.value.base_scope,
  )

  return {
    sessions,
    selectedId,
    error,
    isLoading,
    isAsrEnabled,
    bases,
    pendingScope,
    current,
    scope,
    replayRace,
    chat: conversation,
  }
}

export type KnowledgeChatState = ReturnType<typeof createState>

/**
 * 跑一个动作，出错时把后端那句原话显示出来。
 * @param state 页面状态
 * @param run 要跑的动作
 */
export async function guarded(
  state: KnowledgeChatState,
  run: () => Promise<void>,
): Promise<void> {
  state.error.value = ''
  try {
    await run()
  } catch (cause) {
    state.error.value = messageOf(cause)
  }
}

/** 一个异常里有没有一句能给人看的话。 */
export function messageOf(cause: unknown): string {
  return cause instanceof Error && cause.message !== ''
    ? cause.message
    : '操作失败，请重试'
}

/**
 * 把当前对话的历史读回来灌进时间线。
 * ⚠ 正跑着回合时不动：正跑着的流比库里的旧账新。
 * @param state 页面状态
 */
export async function replaySelected(state: KnowledgeChatState): Promise<void> {
  const id = state.selectedId.value
  if (id === null) {
    state.replayRace.cancel()
    state.chat.clear()
    return
  }
  await state.replayRace.run((signal) => readSession(id, signal), {
    ok: (detail) => state.chat.restore(detail),
    // 回放失败不挡对话：空时间线照样能问，只是提醒一句
    fail: () => state.chat.note('没能读回这个对话的历史，先从空白继续'),
    settled: () => undefined,
  })
}
