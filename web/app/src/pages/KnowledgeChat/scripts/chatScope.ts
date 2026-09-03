/**
 * @fileoverview 检索范围在这一页的几件纯逻辑：怎么显示、怎么摊成 id、
 * 还没建会话时怎么按库清单凑出一份（ADR-0044）。
 *
 * ⚠ `null` 是「全部知识库」，空数组是「一个都没选」——后者后端当场拒。两者在
 * 这一层就不许混：混了的表现是用户清空选择之后，检索悄悄扩回了全部库。因此
 * 「全部」只能由那一项**显式**选出来，取消最后一个勾不算。
 */
import type { KnowledgeChatScopeBase } from '@dt/contracts'

import type { KnowledgeBase } from '@/api/knowledge'

/** 触发器上写的那句话。null = 不限库。 */
export function scopeLabel(
  scope: readonly KnowledgeChatScopeBase[] | null,
): string {
  if (scope === null) return '全部知识库'
  const only = scope.length === 1 ? scope[0] : undefined
  if (only !== undefined) return only.is_missing ? '1 个已删的库' : only.name
  return `${scope.length} 个知识库`
}

/** 范围里那几个库的 id；不限库时给 null。 */
export function idsOf(
  scope: readonly KnowledgeChatScopeBase[] | null,
): string[] | null {
  return scope === null ? null : scope.map((one) => one.base_id)
}

/**
 * 一串 id + 手上的库清单 → 范围。
 * ⚠ 清单里找不到的照样留一条并标成已不存在：悄悄丢掉的话，用户选了三个库、
 * 界面上只剩两个，而没有任何一处说过为什么。
 * @param ids 选中的库；null = 不限库
 * @param bases 这个人看得见的库
 */
export function scopeOfIds(
  ids: readonly string[] | null,
  bases: readonly KnowledgeBase[],
): KnowledgeChatScopeBase[] | null {
  if (ids === null) return null
  return ids.map((id) => {
    const found = bases.find((one) => one.id === id)
    return {
      base_id: id,
      name: found?.name ?? '',
      is_missing: found === undefined,
    }
  })
}

/**
 * 勾选一个库之后的新范围。
 * ⚠ 结果永远非空：取消最后一个勾**不许**变成「全部」——那正是用户刚排除掉的
 * 那些库。界面上把最后一个勾禁掉，不限库走「全部知识库」那一项。
 * @param scope 现在的范围；null = 不限库，等价于全都勾上
 * @param baseId 点了哪个
 * @param bases 这个人看得见的库
 */
export function toggled(
  scope: readonly KnowledgeChatScopeBase[] | null,
  baseId: string,
  bases: readonly KnowledgeBase[],
): string[] {
  const current = idsOf(scope) ?? bases.map((one) => one.id)
  const next = current.includes(baseId)
    ? current.filter((one) => one !== baseId)
    : [...current, baseId]
  return next.length === 0 ? current : next
}
