/**
 * @fileoverview 分组开合的持久化契约：跨重挂记住、各组互不覆盖、
 * 存储坏了或不可用时**不抛异常**（Safari 无痕模式下读写都会抛）。
 */
import { nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useNavGroupOpen } from '@/composables/useNavGroupOpen'

const STORAGE_KEY = 'dt.nav.openGroups'

/** ⚠ 打桩 `Storage.prototype` 对 happy-dom 不生效，只能整个替换全局对象。 */
function stubStorage(fake: Pick<Storage, 'getItem' | 'setItem'>): void {
  vi.stubGlobal('localStorage', fake)
}

function stored(): unknown {
  return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('useNavGroupOpen', () => {
  it('没记过时用给定的初值', () => {
    expect(useNavGroupOpen('system', false).value).toBe(false)
    expect(useNavGroupOpen('knowledge', true).value).toBe(true)
  })

  it('初值为开时立刻落盘——否则离开组后一重挂就合上了', () => {
    useNavGroupOpen('system', true)
    expect(stored()).toEqual(['system'])
    expect(useNavGroupOpen('system', false).value).toBe(true)
  })

  it('改动后写回存储，下次进来读回', async () => {
    const open = useNavGroupOpen('system', false)
    open.value = true
    await nextTick()
    expect(stored()).toEqual(['system'])
    expect(useNavGroupOpen('system', false).value).toBe(true)

    open.value = false
    await nextTick()
    expect(stored()).toEqual([])
    expect(useNavGroupOpen('system', false).value).toBe(false)
  })

  it('记过「合」的组退回初值：路由落在组内时仍摊开', async () => {
    const open = useNavGroupOpen('system', true)
    open.value = false
    await nextTick()
    expect(useNavGroupOpen('system', true).value).toBe(true)
  })

  it('各组只动自己那个键，互不覆盖', async () => {
    const system = useNavGroupOpen('system', false)
    const knowledge = useNavGroupOpen('knowledge', false)
    system.value = true
    await nextTick()
    knowledge.value = true
    await nextTick()
    system.value = false
    await nextTick()

    expect(useNavGroupOpen('knowledge', false).value).toBe(true)
    expect(useNavGroupOpen('system', false).value).toBe(false)
  })

  it('存储里是坏掉的 JSON 时当作没记过，而不是抛出去', () => {
    localStorage.setItem(STORAGE_KEY, '{oops')
    expect(useNavGroupOpen('system', false).value).toBe(false)
  })

  it('存储里混进非字符串时只认字符串那几个', () => {
    localStorage.setItem(STORAGE_KEY, '["system", 1, null]')
    expect(useNavGroupOpen('system', false).value).toBe(true)
  })

  it('读取抛异常时回退初值', () => {
    stubStorage({
      getItem: () => {
        throw new Error('无痕模式')
      },
      setItem: () => undefined,
    })
    expect(useNavGroupOpen('system', true).value).toBe(true)
    expect(useNavGroupOpen('system', false).value).toBe(false)
  })

  it('写入抛异常时只丢偏好，不把页面带崩', async () => {
    const setItem = vi.fn(() => {
      throw new Error('无痕模式')
    })
    stubStorage({ getItem: () => null, setItem })

    const open = useNavGroupOpen('system', false)
    open.value = true
    await expect(nextTick()).resolves.toBeUndefined()
    expect(setItem).toHaveBeenCalled()
    expect(open.value).toBe(true)
  })
})
