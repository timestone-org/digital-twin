/** @fileoverview 绑定清单的筛选条件与有界读取窗口。 */

const MAX_ROWS = 20

/** 只读节点范围：空白与省略均表示当前工作面的全部节点。 */
export function optionalReadNodeId(
  args: Readonly<Record<string, unknown>>,
): string | null {
  const value = args.node_id
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new Error('node_id 必须是字符串或 null')
  return value.trim() === '' ? null : value
}

export interface BindingReportQuery {
  slotKey: string
  entityId: string
  keyword: string
  offset: number
  limit: number
}

export function bindingReportQuery(
  args: Readonly<Record<string, unknown>>,
): BindingReportQuery {
  return {
    slotKey: textArg(args, 'slot_key'),
    entityId: textArg(args, 'entity_id'),
    keyword: textArg(args, 'keyword').toLocaleLowerCase(),
    offset: integerArg(args, 'offset', 0, Number.MAX_SAFE_INTEGER),
    limit: integerArg(args, 'limit', MAX_ROWS, MAX_ROWS),
  }
}

function textArg(args: Readonly<Record<string, unknown>>, key: string): string {
  const value = args[key]
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') throw new Error(`${key} 必须是字符串`)
  return value.trim()
}

function integerArg(
  args: Readonly<Record<string, unknown>>,
  key: string,
  fallback: number,
  maximum: number,
): number {
  const value = args[key] === undefined ? fallback : args[key]
  const minimum = key === 'offset' ? 0 : 1
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new Error(
      `${key} 必须是 ${String(minimum)} 到 ${String(maximum)} 的整数`,
    )
  }
  return value
}
