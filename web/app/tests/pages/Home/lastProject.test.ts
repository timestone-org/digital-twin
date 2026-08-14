/**
 * @fileoverview 上次选中项目的读写：存不下也不许把落地页带崩。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { STORAGE_KEYS } from '@/config/storage'
import { readLastProject, writeLastProject } from '@/pages/Home/lastProject'

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('上次选中的项目', () => {
  it('没存过时给 null', () => {
    expect(readLastProject()).toBeNull()
  })

  it('存进去再读出来是同一个 id', () => {
    writeLastProject('p-1')
    expect(localStorage.getItem(STORAGE_KEYS.lastProject)).toBe('p-1')
    expect(readLastProject()).toBe('p-1')
  })

  it('传 null 是清掉记录', () => {
    writeLastProject('p-1')
    writeLastProject(null)
    expect(readLastProject()).toBeNull()
  })

  it('空白串当没存过', () => {
    localStorage.setItem(STORAGE_KEYS.lastProject, '   ')
    expect(readLastProject()).toBeNull()
  })

  it('读不了存储时退回 null 而不是抛出去', () => {
    // 先存一个真值：不存的话读到 null 也可能只是因为本来就是空的，测不出 catch
    writeLastProject('p-1')
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new Error('无痕模式')
    })
    expect(readLastProject()).toBeNull()
  })

  it('写不进存储时不抛，只是本次会话内有效', () => {
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('配额已满')
    })
    expect(() => writeLastProject('p-2')).not.toThrow()
    vi.restoreAllMocks()
    expect(readLastProject()).toBeNull()
  })

  it('清不掉存储时也不抛', () => {
    vi.spyOn(localStorage, 'removeItem').mockImplementation(() => {
      throw new Error('无痕模式')
    })
    expect(() => writeLastProject(null)).not.toThrow()
  })
})
