/** @fileoverview 模型切换与回合互斥；写入确认丢失时只读核验，未知状态暂停发送。 */
import { onScopeDispose, ref, watch, type Ref } from 'vue'
import { useToast } from '@dt/ui'
import { readSession } from '@/api/assistant'
import type { AiConversation } from './useAiConversation'
import { adoptRow, pickModel, type ModelChoice } from './useAiModelChoice'
import { useRacedFetch, type RacedFetch } from './useRacedFetch'

export interface ModelSelectionStatus {
  isPicking: boolean
  isUnconfirmed: boolean
}
interface SelectionParts {
  choice: Ref<ModelChoice>
  sessionId: Ref<string | null>
  chat: AiConversation
}
interface SelectionState {
  isPickingModel: Ref<boolean>
  isModelUnconfirmed: Ref<boolean>
  verification: RacedFetch
  isDisposed: () => boolean
  error: (message: string) => void
}

/** 管理模型写确认与只读核验，未知状态暂停发送。
 * @param parts 当前会话、选择及对话状态
 */
export function useAiModelSelection(parts: SelectionParts) {
  let isDisposed = false
  const state: SelectionState = {
    isPickingModel: ref(false),
    isModelUnconfirmed: ref(false),
    verification: useRacedFetch(),
    isDisposed: () => isDisposed,
    error: useToast().error,
  }
  onScopeDispose(() => {
    isDisposed = true
    state.verification.cancel()
  })
  watch(
    parts.sessionId,
    () => {
      state.verification.cancel()
      state.isModelUnconfirmed.value = false
    },
    { flush: 'sync' },
  )
  return {
    isPickingModel: state.isPickingModel,
    isModelUnconfirmed: state.isModelUnconfirmed,
    pickModel: (next: ModelChoice) => pick(parts, state, next),
    verifyModel: () => verifyModel(parts, state),
    send: (text: string, images?: string[]) => send(parts, state, text, images),
  }
}

/** 判断当前是否允许发起模型操作。
 * @param parts 会话与对话状态
 * @param state 互斥及核验状态
 */
function canPick(parts: SelectionParts, state: SelectionState): boolean {
  return (
    !state.isDisposed() &&
    !state.isPickingModel.value &&
    !parts.chat.isRunning.value &&
    !parts.chat.isAsking.value
  )
}
/** 判断响应是否仍属于当前存活会话。
 * @param parts 当前会话
 * @param state 生命周期状态
 * @param id 操作发起时的会话标识
 */
function isCurrent(
  parts: SelectionParts,
  state: SelectionState,
  id: string | null,
): boolean {
  return !state.isDisposed() && parts.sessionId.value === id
}
/** 标记模型未确认并清除过期用量。
 * @param parts 当前对话
 * @param state 核验状态
 */
function markUnconfirmed(parts: SelectionParts, state: SelectionState): void {
  state.isModelUnconfirmed.value = true
  parts.chat.contextUsage.value = null
}

/** 提交一次模型选择，失败时只读核验。
 * @param parts 当前会话与选择
 * @param state 操作状态
 * @param next 用户指定的模型选择
 */
async function pick(
  parts: SelectionParts,
  state: SelectionState,
  next: ModelChoice,
): Promise<void> {
  if (!canPick(parts, state)) return
  const id = parts.sessionId.value
  const ownsResponse = () => isCurrent(parts, state, id)
  state.isPickingModel.value = true
  try {
    const selected = await pickModel(
      next,
      parts.choice,
      parts.sessionId,
      ownsResponse,
    )
    if (selected && ownsResponse()) {
      parts.chat.contextUsage.value = null
      state.isModelUnconfirmed.value = false
    }
  } catch (caught) {
    if (ownsResponse()) {
      markUnconfirmed(parts, state)
      state.error(
        caught instanceof Error ? caught.message : '模型切换失败，请稍后重试',
      )
      if (id !== null) await reconcile(parts, state, id)
    }
  } finally {
    if (!state.isDisposed()) state.isPickingModel.value = false
  }
}

/** 读取服务端实际模型，不重试写操作。
 * @param parts 当前会话与选择
 * @param state 核验请求状态
 * @param id 待核验会话
 */
async function reconcile(
  parts: SelectionParts,
  state: SelectionState,
  id: string,
): Promise<void> {
  await state.verification.run((signal) => readSession(id, signal), {
    ok: (row) => {
      if (!isCurrent(parts, state, id)) return
      if (row === null || row.model_profile === null || row.id !== id) return
      adoptRow(parts.choice, row)
      parts.chat.contextUsage.value = null
      state.isModelUnconfirmed.value = false
    },
    fail: () => {
      if (isCurrent(parts, state, id))
        state.error('暂时无法确认当前模型，请恢复连接后重新核验')
    },
    settled: () => {},
  })
}

/** 核验未确认模型并保持发送互斥。
 * @param parts 当前会话与选择
 * @param state 操作状态
 */
async function verifyModel(
  parts: SelectionParts,
  state: SelectionState,
): Promise<void> {
  const id = parts.sessionId.value
  if (!canPick(parts, state) || id === null) return
  state.isPickingModel.value = true
  markUnconfirmed(parts, state)
  try {
    await reconcile(parts, state, id)
  } finally {
    if (!state.isDisposed()) state.isPickingModel.value = false
  }
}

/** 仅在模型已确认且空闲时发送消息。
 * @param parts 当前对话
 * @param state 模型确认状态
 * @param text 用户正文
 * @param images 用户附图
 */
async function send(
  parts: SelectionParts,
  state: SelectionState,
  text: string,
  images?: string[],
): Promise<void> {
  if (
    state.isDisposed() ||
    state.isPickingModel.value ||
    state.isModelUnconfirmed.value
  )
    return
  await parts.chat.send(text, images)
}
