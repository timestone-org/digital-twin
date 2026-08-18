/**
 * @fileoverview 锁住呈现方式的记忆：存得住要记住，存不住也不许把页面带崩。
 * ⚠ Safari 无痕模式下 localStorage 读写都会抛，丢个偏好不该变成白屏。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import { useAcDataView } from '@/pages/Hvac/AcData/scripts/useAcDataView'

const KEY = 'dt.view-mode.hvac-ac-data'

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('useAcDataView', () => {
  it('没存过时默认表格', () => {
    expect(useAcDataView().value).toBe('table')
  })

  it('存过什么就用什么', () => {
    localStorage.setItem(KEY, 'chart')
    expect(useAcDataView().value).toBe('chart')
  })

  it('存着一个不认识的取值时退回表格，而不是把它当成视图名', () => {
    localStorage.setItem(KEY, 'card')
    expect(useAcDataView().value).toBe('table')
  })

  it('改了就写回去', async () => {
    const view = useAcDataView()
    view.value = 'chart'
    await nextTick()
    expect(localStorage.getItem(KEY)).toBe('chart')
  })

  // ⚠ 必须换掉 localStorage 本身：spy 在 Storage.prototype 上不生效——
  // happy-dom 的实例方法不是从那个原型来的，用例会绿得毫无意义
  it('读不了存储时退回表格，不抛给调用方', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('no storage')
      },
      setItem: () => undefined,
    })
    expect(useAcDataView().value).toBe('table')
  })

  it('写不进存储时只是记不住，本次会话内仍然切得动', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {
        throw new Error('no storage')
      },
    })
    const view = useAcDataView()
    view.value = 'chart'
    await nextTick()
    expect(view.value).toBe('chart')
  })
})
