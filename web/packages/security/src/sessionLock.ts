/**
 * @fileoverview 轮换刷新令牌用的跨标签排他锁。
 *
 * ⚠ 刷新令牌是一次性的：服务端换出新的就把旧的拉黑，两个标签同时拿同一枚去换，
 * 后到的那次会被当成重放拒掉。所以轮换必须全局串行——标签内的 single-flight
 * 只挡得住同一个标签里的并发。
 * ⚠ Web Locks 不可用（老浏览器）或等不到锁时退化成直接执行：正确性还有调用方
 * 「进临界区先重读存储、失败再重读一次」兜底，这里只负责把撞车概率压到近零。
 */

/** 锁名。全站唯一一处轮换刷新令牌的临界区。 */
const LOCK_NAME = 'dt.auth.refresh'

/** 等锁上限：持锁标签被冻结时锁不会自动释放，不设上限就是永远挂着。 */
const LOCK_WAIT_MS = 5_000

/** Web Locks 里只用到的这一块；lib.dom 的签名回 `any`，不能让它漏进调用侧。 */
interface LockRequester {
  request(
    name: string,
    options: { signal: AbortSignal },
    callback: () => Promise<unknown>,
  ): Promise<unknown>
}

function isLockRequester(value: unknown): value is LockRequester {
  if (typeof value !== 'object' || value === null) return false
  return 'request' in value && typeof value.request === 'function'
}

/**
 * 在跨标签排他锁内跑一段任务；锁拿不到时照样跑一次。
 * @param task 临界区
 */
export async function withSessionLock<T>(task: () => Promise<T>): Promise<T> {
  const locks: unknown = navigator.locks
  if (!isLockRequester(locks)) return await task()
  // 装在对象里而不是 let：闭包里的赋值 TS 的控制流分析看不见
  const slot: { running: Promise<T> | null } = { running: null }
  try {
    await locks.request(
      LOCK_NAME,
      { signal: AbortSignal.timeout(LOCK_WAIT_MS) },
      () => {
        slot.running = task()
        return slot.running
      },
    )
  } catch {
    // 没开跑 = 等锁失败（锁被冻结的标签攥着），自己上；开跑了就以任务自己的
    // 成败为准——锁释放阶段的错误不该把一次已经换成功的令牌判成失败
    if (slot.running === null) return await task()
  }
  return slot.running === null ? await task() : await slot.running
}
