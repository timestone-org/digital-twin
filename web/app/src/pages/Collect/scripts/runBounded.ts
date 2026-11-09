/**
 * @fileoverview 限并发地逐个跑异步任务，结果按输入顺序给回。
 * 批量改点位每个 PATCH 都会触发一次重新下发采集计划，一次全打出去就是一阵计划风暴。
 */

/** 同时在跑的任务数。 */
export const BATCH_CONCURRENCY = 4

/**
 * 限并发跑完全部任务，单个失败不影响其余。
 * @param items 输入
 * @param task 对每个输入要做的事
 * @param limit 同时在跑的上限
 */
export async function runBounded<T, R>(
  items: readonly T[],
  task: (item: T) => Promise<R>,
  limit: number = BATCH_CONCURRENCY,
): Promise<PromiseSettledResult<R>[]> {
  const results = new Array<PromiseSettledResult<R>>(items.length)
  // 几个 worker 共用同一个迭代器，各自取下一个，天然不重不漏
  const queue = items.entries()
  async function worker(): Promise<void> {
    for (const [index, item] of queue) {
      try {
        results[index] = { status: 'fulfilled', value: await task(item) }
      } catch (reason) {
        results[index] = { status: 'rejected', reason }
      }
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, () =>
    worker(),
  )
  await Promise.all(workers)
  return results
}
