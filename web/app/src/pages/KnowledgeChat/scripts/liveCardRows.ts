/** @fileoverview 同一轮对话的实时卡片并排归组，保留独立订阅身份。 */
import type { ChatEntry } from '@/features/ai/conversationLog'
import {
  livePointOfStep,
  type LivePoint,
} from '@/features/knowledgeChat/liveTools'

export interface LiveCard {
  id: string
  point: LivePoint
}

export function liveCardRows(entries: readonly ChatEntry[]) {
  const rows = new Map<string, LiveCard[]>()
  const visible: ChatEntry[] = []
  let row: LiveCard[] | undefined
  for (const entry of entries) {
    if (entry.role === 'user') row = undefined
    const point = entry.step ? livePointOfStep(entry.step) : null
    if (!point) {
      visible.push(entry)
      continue
    }
    if (!row) {
      row = []
      rows.set(entry.id, row)
      visible.push(entry)
    }
    row.push({ id: entry.id, point })
  }
  return { entries: visible, rows }
}
