/**
 * @fileoverview 回放器：把库里的会话历史读回来灌进时间线。
 *
 * ⚠ 竞态按后一次为准：上一次 readSession 还没回来又开了一次面板时，
 * 前一次在途的读取直接作废，不许旧响应盖掉新的。
 */
import { readSession } from '@/api/assistant'
import type { AiConversation } from '@/composables/useAiConversation'

/** 造一个回放器。abort 在页面卸载时调，掐掉在途的读取。 */
export function createReplayer(chat: AiConversation): {
  replay: (sessionId: string) => Promise<void>
  abort: () => void
} {
  let inFlight: AbortController | null = null

  async function replay(sessionId: string): Promise<void> {
    // 本页生命周期里这段对话已经有内容（来回开合），或回合正跑着：都不灌
    if (chat.entries.value.length > 0 || chat.isRunning.value) return
    inFlight?.abort()
    const controller = new AbortController()
    inFlight = controller
    // 这一次仍是最新的一次，且没被掐掉
    const isCurrent = (): boolean =>
      inFlight === controller && !controller.signal.aborted
    try {
      const detail = await readSession(sessionId, controller.signal)
      if (isCurrent() && detail !== null) chat.restore(detail)
    } catch {
      // 回放失败不挡打开面板：空时间线照样能用，只是提醒一句
      if (isCurrent()) chat.note('没能读回这个会话的历史，先从空白继续')
    } finally {
      if (inFlight === controller) inFlight = null
    }
  }

  return {
    replay,
    abort: () => {
      inFlight?.abort()
    },
  }
}
