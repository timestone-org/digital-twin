/**
 * @fileoverview 一个对话在清单与标题栏上怎么称呼。
 *
 * ⚠ 没标题的对话显示建立时刻而不是空白：标题由首轮摘要出来，摘不出就一直
 * 是空串，一排空白行谁也分不清哪个是哪个。
 */
import type { KnowledgeChatSession } from '@dt/contracts'

import { formatMinuteStamp } from '@/utils/datetime'

/**
 * 对话的显示名。
 * @param one 哪个对话
 */
export function sessionLabel(one: KnowledgeChatSession): string {
  if (one.title !== '') return one.title
  return `未命名 · ${formatMinuteStamp(one.created_at)}`
}
