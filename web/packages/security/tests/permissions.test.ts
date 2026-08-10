/**
 * @fileoverview 锁住闸 3 的判定语义：`any` 的空集合不满足、`all` 的空集合满足。
 * 这两条方向相反，混了会让「没配权限的入口」要么全开要么全关。
 */
import { describe, expect, it } from 'vitest'

import { hasAll, hasAny, isAllowed } from '../src/permissions'

const held = new Set(['user:view', 'user:manage'])

describe('hasAll', () => {
  it('持有全部时为真', () => {
    expect(hasAll(held, ['user:view', 'user:manage'])).toBe(true)
  })

  it('缺一个即为假', () => {
    expect(hasAll(held, ['user:view', 'user:delete'])).toBe(false)
  })

  it('空需求视为满足', () => {
    expect(hasAll(held, [])).toBe(true)
  })
})

describe('hasAny', () => {
  it('命中其一即为真', () => {
    expect(hasAny(held, ['user:delete', 'user:view'])).toBe(true)
  })

  it('一个都不命中为假', () => {
    expect(hasAny(held, ['role:manage'])).toBe(false)
  })

  it('空需求视为不满足', () => {
    expect(hasAny(held, [])).toBe(false)
  })
})

describe('isAllowed', () => {
  it('无需求的入口一律放行', () => {
    expect(isAllowed(new Set(), [])).toBe(true)
  })

  it('默认按 all 判定', () => {
    expect(isAllowed(held, ['user:view', 'role:manage'])).toBe(false)
  })

  it('显式 any 时命中其一即可', () => {
    expect(isAllowed(held, ['user:view', 'role:manage'], 'any')).toBe(true)
  })

  it('空权限集不会误放行有需求的入口', () => {
    expect(isAllowed(new Set(), ['user:view'])).toBe(false)
    expect(isAllowed(new Set(), ['user:view'], 'any')).toBe(false)
  })
})
