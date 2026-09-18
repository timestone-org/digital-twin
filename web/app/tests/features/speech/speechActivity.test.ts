/** @fileoverview 声音能量边界与自动停止计时器清理。 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createSpeechActivity } from '@/features/speech/speechActivity'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

function pcm(amplitude: number, offset = 0): ArrayBuffer {
  const samples = new Int16Array(960)
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = offset + (index % 2 === 0 ? amplitude : -amplitude)
  }
  return samples.buffer
}

it.each([0, 499])('低能量背景 %i 不触发说话，8 秒结束', (amplitude) => {
  const ended = vi.fn()
  const activity = createSpeechActivity(ended)
  activity.accept(new ArrayBuffer(0))
  for (let index = 0; index < 133; index += 1) activity.accept(pcm(amplitude))
  vi.advanceTimersByTime(8000)
  expect(ended).toHaveBeenCalledExactlyOnceWith('no-speech')
  expect(vi.getTimerCount()).toBe(0)
})

it('直流偏移不算声音，叠加实际声音仍可检测', () => {
  const ended = vi.fn()
  const activity = createSpeechActivity(ended)
  activity.accept(pcm(0, 2000))
  activity.accept(pcm(0, 2000))
  vi.advanceTimersByTime(2000)
  expect(ended).not.toHaveBeenCalled()
  activity.accept(pcm(500, 2000))
  activity.accept(pcm(500, 2000))
  vi.advanceTimersByTime(2000)
  expect(ended).toHaveBeenCalledExactlyOnceWith('silence')
})

it('孤立响声之间的静音会清空连续声音时长', () => {
  const ended = vi.fn()
  const activity = createSpeechActivity(ended)
  activity.accept(pcm(2000))
  activity.accept(pcm(0))
  activity.accept(pcm(2000))
  vi.advanceTimersByTime(8000)
  expect(ended).toHaveBeenCalledExactlyOnceWith('no-speech')
})

it('释放后迟到音频不再建计时器或回调', () => {
  const ended = vi.fn()
  const activity = createSpeechActivity(ended)
  activity.accept(pcm(2000))
  activity.accept(pcm(2000))
  activity.dispose()
  activity.dispose()
  activity.accept(pcm(2000))
  vi.advanceTimersByTime(60_000)
  expect(ended).not.toHaveBeenCalled()
  expect(vi.getTimerCount()).toBe(0)
})
