/**
 * @fileoverview 锁住登录态存储：读写容错、跨标签订阅只认登录态那几个键。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  STORAGE_KEYS,
  readItem,
  readJson,
  removeItem,
  subscribeSessionChange,
  writeItem,
} from '../src/tokenStore'

/** 造一个别的标签写存储时浏览器会派发的事件。 */
function storageEvent(key: string | null): StorageEvent {
  return new StorageEvent('storage', { key, storageArea: localStorage })
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('tokenStore', () => {
  it('读写删走一遍', () => {
    writeItem(STORAGE_KEYS.accessToken, 'a1')
    expect(readItem(STORAGE_KEYS.accessToken)).toBe('a1')
    removeItem(STORAGE_KEYS.accessToken)
    expect(readItem(STORAGE_KEYS.accessToken)).toBeNull()
  })

  it('存储不可用时读写都不抛——隐私模式下不能白屏', () => {
    const denied = (): never => {
      throw new Error('denied')
    }
    const brokenStorage: Storage = {
      get length(): number {
        return denied()
      },
      clear: denied,
      getItem: denied,
      key: denied,
      removeItem: denied,
      setItem: denied,
    }
    vi.spyOn(window, 'localStorage', 'get').mockReturnValue(brokenStorage)
    expect(() => {
      writeItem(STORAGE_KEYS.user, '{}')
    }).not.toThrow()
    expect(readItem(STORAGE_KEYS.user)).toBeNull()
    expect(() => {
      removeItem(STORAGE_KEYS.user)
    }).not.toThrow()
  })

  it('损坏的 JSON 读成 null 而不是抛', () => {
    writeItem(STORAGE_KEYS.user, '{not json')
    expect(readJson(STORAGE_KEYS.user)).toBeNull()
  })
})

describe('subscribeSessionChange', () => {
  it('登录态的键变了就通知', () => {
    const handler = vi.fn()
    const off = subscribeSessionChange(handler)
    window.dispatchEvent(storageEvent(STORAGE_KEYS.refreshToken))
    expect(handler).toHaveBeenCalledTimes(1)
    off()
  })

  it('key 为 null（别的标签清空了整个存储）也要通知', () => {
    const handler = vi.fn()
    const off = subscribeSessionChange(handler)
    window.dispatchEvent(storageEvent(null))
    expect(handler).toHaveBeenCalledTimes(1)
    off()
  })

  it('不相干的键不通知', () => {
    const handler = vi.fn()
    const off = subscribeSessionChange(handler)
    window.dispatchEvent(storageEvent('dt.theme'))
    expect(handler).not.toHaveBeenCalled()
    off()
  })

  it('退订后不再通知', () => {
    const handler = vi.fn()
    subscribeSessionChange(handler)()
    window.dispatchEvent(storageEvent(STORAGE_KEYS.accessToken))
    expect(handler).not.toHaveBeenCalled()
  })
})
