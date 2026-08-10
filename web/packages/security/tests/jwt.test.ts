/**
 * @fileoverview 锁住令牌过期判定：解不出 exp 时**不**判过期，
 * 否则一个非 JWT 的令牌会让用户在守卫里被反复踢回登录页。
 */
import { describe, expect, it } from 'vitest'

import { isTokenExpired, readTokenExpiry } from '../src/jwt'

/**
 * 造一个只有载荷段有效的假令牌；本模块不校验签名。
 * ⚠ 必须先转 UTF-8 字节再 base64：`btoa` 对非 ASCII 直接抛，
 * 而真实令牌里带中文用户名是常态。
 */
function fakeToken(payload: Record<string, unknown>): string {
  const bytes = new TextEncoder().encode(JSON.stringify(payload))
  const binary = String.fromCharCode(...bytes)
  const encoded = btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
  return `header.${encoded}.signature`
}

const NOW_MS = 1_800_000_000_000

describe('readTokenExpiry', () => {
  it('取得数字型 exp', () => {
    expect(readTokenExpiry(fakeToken({ exp: 123 }))).toBe(123)
  })

  it('载荷里没有 exp 时返回 null', () => {
    expect(readTokenExpiry(fakeToken({ sub: 'u1' }))).toBeNull()
  })

  it('exp 不是数字时返回 null', () => {
    expect(readTokenExpiry(fakeToken({ exp: '123' }))).toBeNull()
  })

  it('段数不足时返回 null', () => {
    expect(readTokenExpiry('not-a-jwt')).toBeNull()
  })

  it('载荷不是合法 base64 JSON 时返回 null', () => {
    expect(readTokenExpiry('a.!!!.c')).toBeNull()
  })

  it('中文载荷能正确解码', () => {
    expect(readTokenExpiry(fakeToken({ exp: 9, name: '张三' }))).toBe(9)
  })
})

describe('isTokenExpired', () => {
  it('无令牌视为过期', () => {
    expect(isTokenExpired(null, 0, NOW_MS)).toBe(true)
    expect(isTokenExpired('', 0, NOW_MS)).toBe(true)
  })

  it('未到期为假', () => {
    const token = fakeToken({ exp: NOW_MS / 1000 + 600 })
    expect(isTokenExpired(token, 0, NOW_MS)).toBe(false)
  })

  it('已到期为真', () => {
    const token = fakeToken({ exp: NOW_MS / 1000 - 1 })
    expect(isTokenExpired(token, 0, NOW_MS)).toBe(true)
  })

  it('提前量会让临近到期的令牌提前判过期', () => {
    const token = fakeToken({ exp: NOW_MS / 1000 + 30 })
    expect(isTokenExpired(token, 0, NOW_MS)).toBe(false)
    expect(isTokenExpired(token, 60, NOW_MS)).toBe(true)
  })

  it('解不出 exp 时不判过期，交给被动 401 兜底', () => {
    expect(isTokenExpired('opaque-token', 60, NOW_MS)).toBe(false)
  })
})
