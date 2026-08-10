/**
 * @fileoverview 侧栏形态的持久化契约：跨会话记住、非法取值回退、
 * localStorage 不可用时**不抛异常**（Safari 无痕模式下读写都会抛）。
 */
import { nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useSidebar } from '@/composables/useSidebar'

/**
 * ⚠ 打桩 `Storage.prototype` 对 happy-dom 的 localStorage **不生效**——它不从
 * 原型上取方法，桩一个都不会被调用，用例照样绿。只能整个替换全局对象。
 */
function stubStorage(fake: Pick<Storage, 'getItem' | 'setItem'>): void {
  vi.stubGlobal('localStorage', fake)
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('useSidebar', () => {
  it('没存过时默认展开', () => {
    expect(useSidebar().isCollapsed.value).toBe(false)
  })

  it('没存过时用给定的初始形态', () => {
    expect(useSidebar(true).isCollapsed.value).toBe(true)
  })

  it('toggle 在两态之间来回切', () => {
    const sidebar = useSidebar()
    sidebar.toggle()
    expect(sidebar.isCollapsed.value).toBe(true)
    sidebar.toggle()
    expect(sidebar.isCollapsed.value).toBe(false)
  })

  it('切换后写回存储', async () => {
    const sidebar = useSidebar()
    sidebar.toggle()
    await nextTick()
    expect(localStorage.getItem('dt.sidebar.collapsed')).toBe('1')
    sidebar.toggle()
    await nextTick()
    expect(localStorage.getItem('dt.sidebar.collapsed')).toBe('0')
  })

  it('下次进来读回上次的形态，而不是弹回默认', async () => {
    const first = useSidebar()
    first.toggle()
    await nextTick()
    expect(useSidebar().isCollapsed.value).toBe(true)
  })

  it('存过的取值压过 fallback', () => {
    localStorage.setItem('dt.sidebar.collapsed', '0')
    expect(useSidebar(true).isCollapsed.value).toBe(false)
  })

  it('存了个非法值时当作展开，而不是把它当真值用', () => {
    localStorage.setItem('dt.sidebar.collapsed', 'yes')
    expect(useSidebar(true).isCollapsed.value).toBe(false)
  })

  it('读取抛异常时回退给定形态，而不是把「存过折叠」读出来', () => {
    // 存的是折叠：读得到就该是 true，只有真的走了兜底才会落回 fallback
    stubStorage({
      getItem: () => {
        throw new Error('无痕模式')
      },
      setItem: () => undefined,
    })
    expect(useSidebar(false).isCollapsed.value).toBe(false)
  })

  it('写入抛异常时只丢偏好，不把页面带崩', async () => {
    const setItem = vi.fn(() => {
      throw new Error('无痕模式')
    })
    stubStorage({ getItem: () => '0', setItem })

    const sidebar = useSidebar()
    sidebar.toggle()
    await expect(nextTick()).resolves.toBeUndefined()
    expect(setItem).toHaveBeenCalled()
    expect(sidebar.isCollapsed.value).toBe(true)
  })
})
