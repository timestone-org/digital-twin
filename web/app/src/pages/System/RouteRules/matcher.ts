/**
 * @fileoverview 闸 1 判定语义的前端复刻，只用于「试一条路径」的预演。
 *
 * ⚠ 这是**预演不是判定**：真正的判定在 auth-server 的 `/verify` 里。
 * 两份实现必然有漂移风险，所以这里逐条对齐后端 `matching.py` 的语义，
 * 并由契约测试用同一批用例钉住：
 *   · 全序 = priority 降 → 模式长度降 → 模式升 → 方法升
 *   · 首条命中即终局（命中但权限不足不再找更宽的）
 *   · `*` **跨斜杠**匹配，`?` 单字符，`[seq]` / `[!seq]` 字符类
 *   · 无规则一律拒绝
 */

import type { RouteRule } from '@dt/contracts'

export type MatchOutcome = 'granted' | 'insufficient' | 'no_rule'

export interface MatchResult {
  outcome: MatchOutcome
  rule: RouteRule | null
}

/**
 * 把 glob 编译成正则，逐字对齐 Python 的 `fnmatch.fnmatchcase`。
 *
 * ⚠ `[seq]` / `[!seq]` 是**字符类**，不是字面量方括号：早先把 `[` `]` 一并转义，
 * 于是规则 `/api/v1/u[0-9]` 对路径 `/api/v1/u5` 在预演里判「无规则命中」、
 * 在服务端却放行。运维会照着这个假结果去「修」一条本来就对的规则。
 */
function toRegExp(pattern: string): RegExp {
  let source = ''
  let index = 0
  while (index < pattern.length) {
    const char = pattern[index]
    index += 1
    if (char === '*') {
      source += '.*'
    } else if (char === '?') {
      source += '.'
    } else if (char === '[') {
      const closing = findClassEnd(pattern, index)
      if (closing === -1) {
        // 没有配对的 ']'，fnmatch 把这个 '[' 当字面量
        source += '\\['
      } else {
        source += compileCharClass(pattern.slice(index, closing))
        index = closing + 1
      }
    } else {
      source += (char ?? '').replace(/[.+^${}()|[\]\\]/g, '\\$&')
    }
  }
  return new RegExp(`^${source}$`)
}

/**
 * 找字符类的收尾 `]`。紧跟在 `[` 或 `[!` 后面的 `]` 是字面量，不算收尾。
 * @param pattern 整个模式
 * @param start `[` 之后的下标
 */
function findClassEnd(pattern: string, start: number): number {
  let cursor = start
  if (pattern[cursor] === '!') cursor += 1
  if (pattern[cursor] === ']') cursor += 1
  const found = pattern.indexOf(']', cursor)
  return found
}

/**
 * 编译字符类的内容。
 * @param body `[` 与 `]` 之间的原文，可能以 `!` 开头表示取反
 */
function compileCharClass(body: string): string {
  const negated = body.startsWith('!')
  const inner = (negated ? body.slice(1) : body)
    // 类内只有这三个字符对正则有特殊含义
    .replace(/\\/g, '\\\\')
    .replace(/\^/g, '\\^')
    .replace(/\]/g, '\\]')
  return `[${negated ? '^' : ''}${inner}]`
}

/** 去掉 query 与末尾斜杠；根路径保留 `/`。 */
export function normalizePath(raw: string): string {
  const path = raw.split('?')[0]?.split('#')[0] ?? ''
  if (path.length > 1 && path.endsWith('/'))
    return path.replace(/\/+$/, '') || '/'
  return path || '/'
}

/** 全序键，与后端 `sort_key` 同构。 */
function sortKey(rule: RouteRule): [number, number, string, string] {
  return [
    -rule.priority,
    -rule.path_pattern.length,
    rule.path_pattern,
    rule.http_method,
  ]
}

function compare(a: RouteRule, b: RouteRule): number {
  const left = sortKey(a)
  const right = sortKey(b)
  for (let i = 0; i < left.length; i += 1) {
    const x = left[i] as number | string
    const y = right[i] as number | string
    if (x < y) return -1
    if (x > y) return 1
  }
  return 0
}

/** 找首条命中的规则；没有返回 null。只看启用中的规则。 */
export function findRule(
  rules: readonly RouteRule[],
  path: string,
  method: string,
): RouteRule | null {
  const target = normalizePath(path)
  const upper = method.toUpperCase()
  return (
    [...rules]
      .filter((rule) => rule.is_enabled)
      .sort(compare)
      .find(
        (rule) =>
          (rule.http_method === '*' || rule.http_method === upper) &&
          toRegExp(rule.path_pattern).test(target),
      ) ?? null
  )
}

/** 完整判定。`held` 是调用者持有的权限码。 */
export function decide(
  rules: readonly RouteRule[],
  path: string,
  method: string,
  held: ReadonlySet<string>,
): MatchResult {
  const rule = findRule(rules, path, method)
  if (!rule) return { outcome: 'no_rule', rule: null }
  // 空码 = 任意已登录用户放行，不是匿名放行
  if (rule.permission_codes.length === 0) return { outcome: 'granted', rule }
  const satisfied =
    rule.match_mode === 'any'
      ? rule.permission_codes.some((code) => held.has(code))
      : rule.permission_codes.every((code) => held.has(code))
  return { outcome: satisfied ? 'granted' : 'insufficient', rule }
}
