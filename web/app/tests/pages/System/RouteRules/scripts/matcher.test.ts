/**
 * @fileoverview 锁住闸 1 判定在前端的复刻，用例与后端 `test_matching.py` 同构。
 * ⚠ 这份实现只用于「试一条路径」的预演；它与后端漂移不会报错，
 * 只会让运维照着一个错误的预演结果去改真实的鉴权矩阵。
 */
import { describe, expect, it } from 'vitest'
import type { RouteRule } from '@dt/contracts'

import {
  decide,
  findRule,
  normalizePath,
} from '@/pages/System/RouteRules/scripts/matcher'

function rule(over: Partial<RouteRule>): RouteRule {
  return {
    id: over.path_pattern ?? 'r',
    path_pattern: '/x',
    http_method: '*',
    permission_codes: [],
    match_mode: 'all',
    priority: 0,
    is_enabled: true,
    is_builtin: false,
    description: null,
    created_at: '',
    updated_at: '',
    ...over,
  }
}

describe('normalizePath', () => {
  it.each([
    ['/a/b?x=1', '/a/b'],
    ['/a/b/', '/a/b'],
    ['/', '/'],
    ['', '/'],
    ['/a#frag', '/a'],
  ])('%s → %s', (raw, expected) => {
    expect(normalizePath(raw)).toBe(expected)
  })
})

describe('findRule', () => {
  it('* 跨斜杠匹配', () => {
    const rules = [
      rule({ path_pattern: '/api/v1/auth/users*', http_method: 'GET' }),
    ]
    expect(
      findRule(rules, '/api/v1/auth/users/1/permissions', 'GET'),
    ).not.toBeNull()
  })

  it('高优先级胜出，哪怕它更宽', () => {
    const rules = [
      rule({ path_pattern: '/u/*', priority: 10, permission_codes: ['a'] }),
      rule({ path_pattern: '/u/me*', priority: 99 }),
    ]
    expect(findRule(rules, '/u/me', 'GET')?.priority).toBe(99)
  })

  it('同 priority 时模式更长的先命中', () => {
    const rules = [
      rule({ path_pattern: '/a*', priority: 5 }),
      rule({ path_pattern: '/a/b*', priority: 5 }),
    ]
    expect(findRule(rules, '/a/b', 'GET')?.path_pattern).toBe('/a/b*')
  })

  it('方法不符不命中', () => {
    const rules = [rule({ path_pattern: '/x', http_method: 'POST' })]
    expect(findRule(rules, '/x', 'GET')).toBeNull()
  })

  it('停用的规则不参与判定', () => {
    const rules = [rule({ path_pattern: '/x', is_enabled: false })]
    expect(findRule(rules, '/x', 'GET')).toBeNull()
  })

  it('模式里的正则元字符按字面量处理', () => {
    const rules = [rule({ path_pattern: '/a.b' })]
    expect(findRule(rules, '/axb', 'GET')).toBeNull()
    expect(findRule(rules, '/a.b', 'GET')).not.toBeNull()
  })
})

describe('decide', () => {
  it('无规则一律拒绝', () => {
    expect(decide([], '/x', 'GET', new Set(['a'])).outcome).toBe('no_rule')
  })

  it('首条命中即终局，不再找更宽松的规则', () => {
    const rules = [
      rule({
        path_pattern: '/x/secret',
        priority: 50,
        permission_codes: ['admin'],
      }),
      rule({ path_pattern: '/x/*', priority: 10 }),
    ]
    expect(decide(rules, '/x/secret', 'GET', new Set()).outcome).toBe(
      'insufficient',
    )
  })

  it('空码放行任意已登录用户', () => {
    const rules = [rule({ path_pattern: '/open' })]
    expect(decide(rules, '/open', 'GET', new Set()).outcome).toBe('granted')
  })

  it('all 要求全部持有', () => {
    const rules = [rule({ path_pattern: '/x', permission_codes: ['a', 'b'] })]
    expect(decide(rules, '/x', 'GET', new Set(['a'])).outcome).toBe(
      'insufficient',
    )
    expect(decide(rules, '/x', 'GET', new Set(['a', 'b'])).outcome).toBe(
      'granted',
    )
  })

  it('any 命中其一即可', () => {
    const rules = [
      rule({
        path_pattern: '/x',
        permission_codes: ['a', 'b'],
        match_mode: 'any',
      }),
    ]
    expect(decide(rules, '/x', 'GET', new Set(['b'])).outcome).toBe('granted')
  })
})

describe('glob 与后端 fnmatch 的一致性', () => {
  // 取值逐条对过 Python 的 fnmatch.fnmatchcase；不一致就是预演在骗人
  const CASES: ReadonlyArray<[string, string, boolean]> = [
    ['/api/v1/[ab]/x', '/api/v1/a/x', true],
    ['/api/v1/[ab]/x', '/api/v1/c/x', false],
    ['/api/v1/u[0-9]', '/api/v1/u5', true],
    ['/api/v1/u[0-9]', '/api/v1/ux', false],
    ['/api/v1/[!a]/x', '/api/v1/b/x', true],
    ['/api/v1/[!a]/x', '/api/v1/a/x', false],
    ['/api/v1/u?', '/api/v1/u5', true],
    ['/api/v1/u?', '/api/v1/u55', false],
    // 没有配对的 ']'，'[' 按字面量处理
    ['/api/v1/[abc', '/api/v1/[abc', true],
    // '*' 跨斜杠
    ['/api/v1/*', '/api/v1/auth/users', true],
  ]

  it.each(CASES)('%s vs %s', (pattern, path, expected) => {
    const target = rule({ path_pattern: pattern, permission_codes: [] })
    const hit = findRule([target], path, 'GET')
    expect(hit !== null).toBe(expected)
  })
})
