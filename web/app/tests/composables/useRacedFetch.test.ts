/**
 * @fileoverview 竞态防护本身的用例：后发先至、作废在飞的那一次、中止信号。
 *
 * ⚠ 这一件是全系统「可被快速切换触发的加载」唯一的实现。它漏一条路径，
 * 界面就会显示过期数据，而**没有任何报错**——所以每条路径都要单独锁。
 */
import { describe, expect, it, vi } from 'vitest'

import { useRacedFetch } from '@/composables/useRacedFetch'

type Resolve = (value: string) => void

function deferred(): { promise: Promise<string>; resolve: Resolve } {
  let resolve: Resolve = () => {}
  const promise = new Promise<string>((done) => (resolve = done))
  return { promise, resolve }
}

function handlers(): {
  ok: ReturnType<typeof vi.fn>
  fail: ReturnType<typeof vi.fn>
  settled: ReturnType<typeof vi.fn>
} {
  return { ok: vi.fn(), fail: vi.fn(), settled: vi.fn() }
}

describe('useRacedFetch', () => {
  it('把结果交给成功回调', async () => {
    const raced = useRacedFetch()
    const seen = handlers()
    await raced.run(() => Promise.resolve('一'), seen)
    expect(seen.ok).toHaveBeenCalledWith('一')
    expect(seen.settled).toHaveBeenCalledTimes(1)
  })

  it('慢的那次后返回时整个丢弃', async () => {
    const raced = useRacedFetch()
    const slow = deferred()
    const first = handlers()
    const second = handlers()
    const pending = raced.run(() => slow.promise, first)
    await raced.run(() => Promise.resolve('新'), second)
    slow.resolve('旧')
    await pending
    expect(second.ok).toHaveBeenCalledWith('新')
    expect(first.ok).not.toHaveBeenCalled()
    expect(first.settled).not.toHaveBeenCalled()
  })

  it('被顶掉的那次连失败回调也不走', async () => {
    const raced = useRacedFetch()
    const first = handlers()
    let reject: (error: Error) => void = () => {}
    const failing = new Promise<string>((_ok, no) => (reject = no))
    const pending = raced.run(() => failing, first)
    await raced.run(() => Promise.resolve('新'), handlers())
    reject(new Error('晚到的失败'))
    await pending
    expect(first.fail).not.toHaveBeenCalled()
  })

  it('作废之后，在飞的那次不许再写状态', async () => {
    const raced = useRacedFetch()
    const slow = deferred()
    const seen = handlers()
    const pending = raced.run(() => slow.promise, seen)
    raced.cancel()
    slow.resolve('卸载后才回来的')
    await pending
    expect(seen.ok).not.toHaveBeenCalled()
    expect(seen.settled).not.toHaveBeenCalled()
  })

  it('作废会中止在飞那次的信号', async () => {
    const raced = useRacedFetch()
    const seen: AbortSignal[] = []
    const slow = deferred()
    const pending = raced.run((given) => {
      seen.push(given)
      return slow.promise
    }, handlers())
    expect(seen[0]?.aborted).toBe(false)
    raced.cancel()
    expect(seen[0]?.aborted).toBe(true)
    slow.resolve('无所谓')
    await pending
  })

  it('后一次会中止前一次的信号', async () => {
    const raced = useRacedFetch()
    const seen: AbortSignal[] = []
    const slow = deferred()
    const pending = raced.run((given) => {
      seen.push(given)
      return slow.promise
    }, handlers())
    await raced.run(() => Promise.resolve('新'), handlers())
    expect(seen[0]?.aborted).toBe(true)
    slow.resolve('旧')
    await pending
  })

  it('作废之后仍可重新发起', async () => {
    const raced = useRacedFetch()
    raced.cancel()
    const seen = handlers()
    await raced.run(() => Promise.resolve('重来'), seen)
    expect(seen.ok).toHaveBeenCalledWith('重来')
  })
})
