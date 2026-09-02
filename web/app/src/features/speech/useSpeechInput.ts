/**
 * @fileoverview 知识库对话的语音输入：把 `speechSession.ts` 的状态机绑到当前作用域，
 * 登录态从 auth store 取，卸载即作废（连接、麦克风、定时器一起放掉）。
 */
import { getCurrentScope, onScopeDispose, ref, type Ref } from 'vue'

import { useAuthStore } from '@/stores/auth'
import {
  cancelSession,
  createSession,
  startSession,
  stopSession,
  type SpeechStatus,
} from './speechSession'

export type { SpeechStatus } from './speechSession'

export interface SpeechInput {
  status: Ref<SpeechStatus>
  /** 到目前为止的整段转写；每帧整体替换，不在这里拼。 */
  transcript: Ref<string>
  /** 一句给人看的失败原因；空串 = 没出错。 */
  error: Ref<string>
  start: () => Promise<void>
  /** 这一句说完了：送 stop、停麦、等终稿。 */
  stop: () => void
  /** 作废：送 cancel、全部清理、转写清空。 */
  cancel: () => void
}

/** 造一路语音输入。同一时刻只有一句在录；卸载即作废。 */
export function useSpeechInput(): SpeechInput {
  const session = createSession(ref<SpeechStatus>('idle'), ref(''), ref(''))
  const cancel = (): void => cancelSession(session)
  if (getCurrentScope() !== undefined) onScopeDispose(cancel)
  return {
    status: session.status,
    transcript: session.transcript,
    error: session.error,
    start: () => startSession(session, useAuthStore().accessToken),
    stop: () => stopSession(session),
    cancel,
  }
}
