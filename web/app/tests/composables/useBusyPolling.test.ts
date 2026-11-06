/** @fileoverview 忙时轮询的三条底线：不叠拍、到终态停、卸载后不再起表。 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { mount } from '@vue/test-utils'

import { useBusyPolling, type BusyPolling } from '@/composables/useBusyPolling'

const INTERVAL_MS = 1000

function mountPolling(refresh: () => Promise<void>): {
  polling: BusyPolling
  unmount: () => void
} {
  let polling: BusyPolling | null = null
  const wrapper = mount(
    defineComponent({
      setup() {
        polling = useBusyPolling(refresh, INTERVAL_MS)
        return () => null
      },
    }),
  )
  if (polling === null) throw new Error('轮询没有装上')
  return { polling, unmount: () => wrapper.unmount() }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useBusyPolling', () => {
  it('忙时按间隔刷新，重复 sync 不叠定时器', async () => {
    const refresh = vi.fn(() => Promise.resolve())
    const { polling } = mountPolling(refresh)

    polling.sync(true)
    polling.sync(true)
    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 2)

    expect(refresh).toHaveBeenCalledTimes(2)
  })

  it('上一次没回来就跳过这一拍，回来后恢复', async () => {
    let finish: () => void = () => undefined
    const refresh = vi
      .fn<() => Promise<void>>()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve
          }),
      )
      .mockResolvedValue(undefined)
    const { polling } = mountPolling(refresh)
    polling.sync(true)

    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 3)
    expect(refresh).toHaveBeenCalledOnce()

    finish()
    await vi.advanceTimersByTimeAsync(INTERVAL_MS)
    expect(refresh).toHaveBeenCalledTimes(2)
  })

  it('到终态停表', async () => {
    const refresh = vi.fn(() => Promise.resolve())
    const { polling } = mountPolling(refresh)
    polling.sync(true)

    polling.sync(false)
    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 3)

    expect(refresh).not.toHaveBeenCalled()
  })

  it('卸载时停表，卸载后再 sync 也不起表', async () => {
    const refresh = vi.fn(() => Promise.resolve())
    const { polling, unmount } = mountPolling(refresh)
    polling.sync(true)

    unmount()
    polling.sync(true)
    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 3)

    expect(refresh).not.toHaveBeenCalled()
    expect(polling.isDisposed()).toBe(true)
  })
})
