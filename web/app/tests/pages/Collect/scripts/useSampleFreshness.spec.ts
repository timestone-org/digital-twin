/** @fileoverview 陈旧集合成员不变时保持同一个对象，点位表不必每秒整表重渲。 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { useSampleFreshness } from '@/pages/Collect/scripts/useSampleFreshness'
import { harness } from '@/testing/hierarchyHarness'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

it('每秒走一下表但成员没变时，staleKeys 还是同一个集合', async () => {
  const { state, wrapper } = harness(() => useSampleFreshness(ref(true)))
  state.mark(['a'])
  const first = state.staleKeys.value
  await vi.advanceTimersByTimeAsync(1000)
  expect(state.staleKeys.value).toBe(first)
  await vi.advanceTimersByTimeAsync(45_000)
  expect(state.staleKeys.value.has('a')).toBe(true)
  const stale = state.staleKeys.value
  await vi.advanceTimersByTimeAsync(1000)
  expect(state.staleKeys.value).toBe(stale)
  wrapper.unmount()
})
