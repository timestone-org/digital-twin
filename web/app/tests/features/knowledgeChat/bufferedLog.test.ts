/** @fileoverview 流式发布限频、终稿与卸载清理。 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createBufferedLog } from '@/features/knowledgeChat/bufferedLog'
import { emptyLog, withDelta, withReply } from '@/features/ai/conversationLog'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

it('同一气泡在 50 ms 内仅发布一次并保留全部增量', () => {
  const state = createBufferedLog()
  state.edit((log) => withDelta(log, 'text', '你'))
  state.edit((log) => withDelta(log, 'text', '好'))
  expect(state.log.value.entries[0]?.text).toBe('你')
  expect(vi.getTimerCount()).toBe(1)
  vi.advanceTimersByTime(50)
  expect(state.log.value.entries[0]?.text).toBe('你好')
  expect(vi.getTimerCount()).toBe(0)
})

it('终稿立即刷新且取消待发布的旧快照', () => {
  const state = createBufferedLog()
  state.edit((log) => withDelta(log, 'text', '你'))
  state.edit((log) => withDelta(log, 'text', '好'))
  state.edit((log) => withReply(log, '你好'))
  expect(state.log.value.entries[0]?.text).toBe('你好')
  expect(state.log.value.entries[0]?.isStreaming).toBe(false)
  expect(vi.getTimerCount()).toBe(0)
})

it('清屏后不被延迟快照覆盖', () => {
  const state = createBufferedLog()
  state.edit((log) => withDelta(log, 'text', '你'))
  state.edit((log) => withDelta(log, 'text', '好'))
  state.edit(emptyLog)
  vi.advanceTimersByTime(50)
  expect(state.log.value.entries).toEqual([])
})

it('卸载后释放计时器，迟到的回合不再发布状态', () => {
  const state = createBufferedLog()
  state.edit((log) => withDelta(log, 'text', '你'))
  state.edit((log) => withDelta(log, 'text', '好'))
  const before = state.log.value
  state.dispose()
  state.edit((log) => withReply(log, '你好'))
  state.flush()
  expect(state.log.value).toBe(before)
  expect(vi.getTimerCount()).toBe(0)
})
