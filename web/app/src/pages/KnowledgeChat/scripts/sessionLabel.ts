/**
 * @fileoverview 一个对话在清单与标题栏上怎么称呼。
 *
 * ⚠ 仍然保留「未命名 · 时刻」这一支：标题在首轮之后由服务端自动起（起不出来
 * 也会退回用户那句话的开头），所以走到这里的只有**一轮都还没发过**的会话——
 * 而那时一排空白行谁也分不清哪个是哪个。
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
