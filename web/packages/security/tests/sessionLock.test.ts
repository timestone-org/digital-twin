/**
 * @fileoverview 锁住跨标签排他锁：有锁就在锁内跑，没锁/等不到锁也必须跑一次。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { withSessionLock } from '../src/sessionLock'

/** 用 defineProperty 而不是赋值：happy-dom 的 `locks` 是原型上的只读取值器。 */
function stubLocks(value: unknown): void {
  Object.defineProperty(navigator, 'locks', { value, configurable: true })
}

afterEach(() => {
  Reflect.deleteProperty(navigator, 'locks')
})

describe('withSessionLock', () => {
  it('没有 Web Locks 时直接执行', async () => {
    stubLocks(undefined)
    await expect(withSessionLock(() => Promise.resolve('done'))).resolves.toBe(
      'done',
    )
  })

  it('happy-dom 那种不是 LockManager 的替身也当没有', async () => {
    stubLocks('not-a-lock-manager')
    await expect(withSessionLock(() => Promise.resolve(1))).resolves.toBe(1)
  })

  it('有 Web Locks 时任务跑在锁内并回传结果', async () => {
    const request = vi.fn(
      async (_name: string, _options: unknown, callback: () => unknown) =>
        await callback(),
    )
    stubLocks({ request })
    await expect(withSessionLock(() => Promise.resolve('v'))).resolves.toBe('v')
    expect(request).toHaveBeenCalledWith(
      'dt.auth.refresh',
      expect.objectContaining({ signal: expect.anything() }),
      expect.any(Function),
    )
  })

  it('任务自己抛的错原样抛出，不会被重跑一遍', async () => {
    stubLocks({
      request: async (
        _name: string,
        _options: unknown,
        callback: () => unknown,
      ) => await callback(),
    })
    const task = vi.fn(() => Promise.reject(new Error('boom')))
    await expect(withSessionLock(task)).rejects.toThrow('boom')
    expect(task).toHaveBeenCalledTimes(1)
  })

  it('等锁超时就自己上——持锁标签被冻结时不能干等', async () => {
    // 拿不到锁：request 直接拒绝，callback 一次都没跑
    stubLocks({
      request: () => Promise.reject(new DOMException('timeout', 'AbortError')),
    })
    const task = vi.fn(() => Promise.resolve('fallback'))
    await expect(withSessionLock(task)).resolves.toBe('fallback')
    expect(task).toHaveBeenCalledTimes(1)
  })

  it('锁释放阶段的错误不该盖掉已经成功的任务', async () => {
    stubLocks({
      request: async (
        _name: string,
        _options: unknown,
        callback: () => unknown,
      ) => {
        await callback()
        throw new DOMException('released', 'AbortError')
      },
    })
    const task = vi.fn(() => Promise.resolve('x'))
    await expect(withSessionLock(task)).resolves.toBe('x')
    expect(task).toHaveBeenCalledTimes(1)
  })
})
