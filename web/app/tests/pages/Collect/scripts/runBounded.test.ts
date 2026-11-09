/** @fileoverview 限并发执行：在跑的不超过上限，结果按输入顺序，失败不拖累其余。 */
import { expect, it } from 'vitest'
import { runBounded } from '@/pages/Collect/scripts/runBounded'

it('同时在跑的不超过上限，结果按输入顺序给回', async () => {
  let running = 0
  let peak = 0
  const results = await runBounded(
    Array.from({ length: 10 }, (_, index) => index),
    async (item) => {
      running += 1
      peak = Math.max(peak, running)
      await new Promise((done) => setTimeout(done, 1))
      running -= 1
      if (item === 3) throw new Error('第 3 个失败')
      return item * 2
    },
    4,
  )
  expect(peak).toBe(4)
  expect(results.map((one) => one.status)).toEqual([
    'fulfilled',
    'fulfilled',
    'fulfilled',
    'rejected',
    'fulfilled',
    'fulfilled',
    'fulfilled',
    'fulfilled',
    'fulfilled',
    'fulfilled',
  ])
  expect(results[9]).toEqual({ status: 'fulfilled', value: 18 })
})

it('空输入直接给空结果', async () => {
  expect(await runBounded([], () => Promise.resolve(1))).toEqual([])
})
