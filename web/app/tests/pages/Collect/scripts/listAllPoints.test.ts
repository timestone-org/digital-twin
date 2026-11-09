/** @fileoverview 全量翻页：按总数停、空页停、中止后不再取下一页。 */
import { afterEach, expect, it, vi } from 'vitest'
import * as collect from '@/api/collect'
import { listAllPoints } from '@/pages/Collect/scripts/listAllPoints'
import { POINT } from '@/testing/knowledgeLive'

afterEach(() => vi.restoreAllMocks())

function pageOf(count: number, total: number, offset = 0) {
  return {
    items: Array.from({ length: count }, (_, index) => ({
      ...POINT,
      id: `p${offset + index}`,
      code: `c${offset + index}`,
    })),
    page: 1,
    size: 100,
    total,
  }
}

it('总数 250 翻三页取完', async () => {
  const list = vi
    .spyOn(collect, 'listPoints')
    .mockResolvedValueOnce(pageOf(100, 250))
    .mockResolvedValueOnce(pageOf(100, 250, 100))
    .mockResolvedValueOnce(pageOf(50, 250, 200))
  const points = await listAllPoints('s1')
  expect(list).toHaveBeenCalledTimes(3)
  expect(points).toHaveLength(250)
  expect(list.mock.calls[2]?.[0]).toEqual({
    sourceId: 's1',
    page: 3,
    size: 100,
  })
})

it('取到空页就停，不会因为总数对不上一直翻', async () => {
  const list = vi
    .spyOn(collect, 'listPoints')
    .mockResolvedValueOnce(pageOf(100, 500))
    .mockResolvedValueOnce(pageOf(0, 500))
  expect(await listAllPoints('s1')).toHaveLength(100)
  expect(list).toHaveBeenCalledTimes(2)
})

it('中止之后不再取下一页', async () => {
  const controller = new AbortController()
  const list = vi.spyOn(collect, 'listPoints').mockImplementation(() => {
    controller.abort()
    return Promise.resolve(pageOf(100, 300))
  })
  await listAllPoints('s1', controller.signal)
  expect(list).toHaveBeenCalledTimes(1)
})
