/**
 * @fileoverview 展示方式的持久化契约：按页记住、非法取值回退、
 * localStorage 不可用时**不抛异常**（Safari 无痕模式下写入会抛）。
 */
import { nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useViewMode } from '@/composables/useViewMode'

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('useViewMode', () => {
  it('没存过时用给定的默认值', () => {
    expect(useViewMode('a').value).toBe('table')
    expect(useViewMode('b', 'card').value).toBe('card')
  })

  it('改动会写回存储', async () => {
    const mode = useViewMode('users')
    mode.value = 'card'
    await nextTick()
    expect(localStorage.getItem('dt.view-mode.users')).toBe('card')
  })

  it('下次进同一页读回上次的选择', async () => {
    const first = useViewMode('roles')
    first.value = 'card'
    await nextTick()
    expect(useViewMode('roles').value).toBe('card')
  })

  it('两个页面各记各的，不互相串', async () => {
    const users = useViewMode('users')
    users.value = 'card'
    await nextTick()
    expect(useViewMode('rules').value).toBe('table')
  })

  it('存了个非法值时回退，而不是把它当视图名用', () => {
    localStorage.setItem('dt.view-mode.weird', 'sideways')
    expect(useViewMode('weird').value).toBe('table')
  })

  // ⚠ 这两条必须用 stubGlobal 换掉整个 localStorage：happy-dom 下
  // `vi.spyOn(Storage.prototype, …)` 的桩**一次都不会被调用**，用例照样绿，
  // 而 catch 分支实际从没执行过——是假绿。
  it('读取抛异常时回退默认值', () => {
    const getItem = vi.fn(() => {
      throw new Error('无痕模式')
    })
    vi.stubGlobal('localStorage', { getItem, setItem: vi.fn() })
    expect(useViewMode('boom', 'card').value).toBe('card')
    expect(getItem).toHaveBeenCalled()
  })

  it('写入抛异常时只丢偏好，不把页面带崩', async () => {
    const setItem = vi.fn(() => {
      throw new Error('无痕模式')
    })
    vi.stubGlobal('localStorage', { getItem: vi.fn(() => null), setItem })
    const mode = useViewMode('boom')
    mode.value = 'card'
    await expect(nextTick()).resolves.toBeUndefined()
    expect(setItem).toHaveBeenCalled()
    expect(mode.value).toBe('card')
  })
})
