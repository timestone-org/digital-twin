/** @fileoverview 孪生工具列表的过滤、分页与续查元数据。 */
import type { AssistantToolCall } from '@dt/contracts'

const MAX_ITEMS = 20

export function pageItems<T extends { id: string; name: string }>(
  items: readonly T[],
  call: AssistantToolCall,
) {
  const page = integerArg(call, 'page', 1, Number.MAX_SAFE_INTEGER)
  const limit = integerArg(call, 'limit', MAX_ITEMS, MAX_ITEMS)
  const given = call.arguments['keyword']
  if (given !== undefined && typeof given !== 'string')
    throw new Error('keyword 必须是字符串')
  const keyword =
    typeof given === 'string' ? given.trim().toLocaleLowerCase() : ''
  const matched = items.filter((item) =>
    `${item.id} ${item.name}`.toLocaleLowerCase().includes(keyword),
  )
  const offset = (page - 1) * limit
  const hasMore = offset + limit < matched.length
  return {
    items: matched.slice(offset, offset + limit),
    metadata: {
      page,
      limit,
      total: matched.length,
      has_more: hasMore,
      next_page: hasMore ? page + 1 : null,
      is_truncated: hasMore,
    },
  }
}

function integerArg(
  call: AssistantToolCall,
  key: string,
  fallback: number,
  maximum: number,
): number {
  const given = call.arguments[key]
  const value = given === undefined ? fallback : given
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > maximum
  )
    throw new Error(`${key} 必须是 1 到 ${String(maximum)} 的整数`)
  return value
}
