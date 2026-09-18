/** @fileoverview 对话时间线的浅层快照与流式发布节流。 */
import { shallowRef } from 'vue'
import { emptyLog, type ConversationLog } from '@/features/ai/conversationLog'

const PUBLISH_INTERVAL_MS = 50

export function createBufferedLog() {
  let disposed = false
  let current = emptyLog()
  const log = shallowRef(current)
  let timer: ReturnType<typeof setTimeout> | undefined
  const cancel = (): void => {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
  }
  const flush = (): void => {
    cancel()
    if (!disposed) log.value = current
  }
  const edit = (next: (given: ConversationLog) => ConversationLog): void => {
    if (disposed) return
    const previous = current
    current = next(current)
    // ⚠ 新条目与收口立即发布，只有同一气泡的连续增量合批。
    const continues =
      current.entries.length === previous.entries.length &&
      (current.openText !== null || current.openReasoning !== null)
    if (!continues) flush()
    else if (timer === undefined) timer = setTimeout(flush, PUBLISH_INTERVAL_MS)
  }
  const dispose = (): void => {
    cancel()
    disposed = true
  }
  return { log, edit, flush, dispose }
}
