/**
 * @fileoverview 锁住「一次只放一页」的游标翻页：下一页替换而不是追加、上一页
 * 重放来时那个游标、reload 清空游标栈、页序与屏幕上那一页始终一致。
 * ⚠ 「替换」写成「追加」时界面看着还在翻页，只是 DOM 一路涨到卡住。
 * ⚠ 游标栈忘了清就会翻进上一串结果的中间，而那一页看着完全正常。
 */
import { describe, expect, it, vi, type Mock } from 'vitest'
import type { CursorPage } from '@dt/contracts'

import { describeError } from '@/composables/useAsyncList'
import { useCursorPages } from '@/composables/useCursorPages'

type Fetcher = (after: string | null) => Promise<CursorPage<string>>

function page(items: string[], next: string | null = null): CursorPage<string> {
  return { items, next, has_more: next !== null }
}

/** 按顺序吐出这几页；用完之后再取就会挂着不返回，正好暴露多余的请求。 */
function fetcherOf(...pages: CursorPage<string>[]): Mock<Fetcher> {
  const mock = vi.fn<Fetcher>()
  for (const one of pages) mock.mockResolvedValueOnce(one)
  return mock.mockReturnValue(new Promise(() => undefined))
}

describe('useCursorPages', () => {
  it('首屏取第一页：不带 after，页序是 1，没有上一页', async () => {
    const fetcher = fetcherOf(page(['a'], 'C1'))
    const pages = useCursorPages(fetcher, describeError)
    await pages.reload()
    expect(fetcher.mock.calls[0]?.[0]).toBeNull()
    expect(pages.items.value).toEqual(['a'])
    expect(pages.pageNumber.value).toBe(1)
    expect(pages.hasPrev.value).toBe(false)
    expect(pages.hasNext.value).toBe(true)
  })

  it('下一页是替换不是追加——同时只留一页', async () => {
    const fetcher = fetcherOf(page(['a'], 'C1'), page(['b']))
    const pages = useCursorPages(fetcher, describeError)
    await pages.reload()
    await pages.next()
    expect(pages.items.value).toEqual(['b'])
    expect(pages.pageNumber.value).toBe(2)
    expect(pages.hasNext.value).toBe(false)
    expect(pages.hasPrev.value).toBe(true)
  })

  it('游标原样带回去当 after，一个字符都不动', async () => {
    const fetcher = fetcherOf(page(['a'], 'eyJ0cyI6ICIyMDI2In0='), page(['b']))
    const pages = useCursorPages(fetcher, describeError)
    await pages.reload()
    await pages.next()
    expect(fetcher.mock.calls[1]?.[0]).toBe('eyJ0cyI6ICIyMDI2In0=')
  })

  it('翻过去再翻回来，拿到的是第一页那几条', async () => {
    const fetcher = fetcherOf(page(['a'], 'C1'), page(['b'], 'C2'), page(['a']))
    const pages = useCursorPages(fetcher, describeError)
    await pages.reload()
    await pages.next()
    await pages.prev()
    expect(fetcher.mock.calls[2]?.[0]).toBeNull()
    expect(pages.items.value).toEqual(['a'])
    expect(pages.pageNumber.value).toBe(1)
    expect(pages.hasPrev.value).toBe(false)
  })

  it('第三页往回退用的是第二页那个游标，不是第一页的', async () => {
    const fetcher = fetcherOf(
      page(['a'], 'C1'),
      page(['b'], 'C2'),
      page(['c'], 'C3'),
      page(['b'], 'C2'),
    )
    const pages = useCursorPages(fetcher, describeError)
    await pages.reload()
    await pages.next()
    await pages.next()
    await pages.prev()
    expect(fetcher.mock.calls[3]?.[0]).toBe('C1')
    expect(pages.pageNumber.value).toBe(2)
  })

  it('第一页上点不出「上一页」的请求', async () => {
    const fetcher = fetcherOf(page(['a'], 'C1'))
    const pages = useCursorPages(fetcher, describeError)
    await pages.reload()
    await pages.prev()
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('没有下一页时点不出请求', async () => {
    const fetcher = fetcherOf(page(['a']))
    const pages = useCursorPages(fetcher, describeError)
    await pages.reload()
    await pages.next()
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('上一次翻页还没回来时不重复发起——连点两下只该取一页', async () => {
    const fetcher = vi
      .fn<Fetcher>()
      .mockResolvedValueOnce(page(['a'], 'C1'))
      .mockReturnValueOnce(new Promise(() => undefined))
    const pages = useCursorPages(fetcher, describeError)
    await pages.reload()
    void pages.next()
    await pages.next()
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('reload 把游标栈清空，回到第一页——换筛选后不许翻进上一串结果', async () => {
    const fetcher = fetcherOf(page(['a'], 'C1'), page(['b'], 'C2'), page(['x']))
    const pages = useCursorPages(fetcher, describeError)
    await pages.reload()
    await pages.next()
    await pages.reload()
    expect(fetcher.mock.calls[2]?.[0]).toBeNull()
    expect(pages.pageNumber.value).toBe(1)
    expect(pages.hasPrev.value).toBe(false)
  })

  it('reload 不被「取数中」挡掉——换房间紧接着换筛选，赢的必须是后一次', async () => {
    const slow = Promise.resolve(page(['旧']))
    const fetcher = vi
      .fn<Fetcher>()
      .mockReturnValueOnce(slow)
      .mockResolvedValueOnce(page(['新']))
    const pages = useCursorPages(fetcher, describeError)
    void pages.reload()
    await pages.reload()
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(pages.items.value).toEqual(['新'])
  })

  it('refresh 原地重取当前页——写操作之后不把人甩回第一页', async () => {
    const fetcher = fetcherOf(
      page(['a'], 'C1'),
      page(['b'], 'C2'),
      page(['b*'], 'C2'),
    )
    const pages = useCursorPages(fetcher, describeError)
    await pages.reload()
    await pages.next()
    await pages.refresh()
    expect(fetcher.mock.calls[2]?.[0]).toBe('C1')
    expect(pages.items.value).toEqual(['b*'])
    expect(pages.pageNumber.value).toBe(2)
  })

  it('失败时清空这一页并记下原因，页序仍指着刚才要去的那一页', async () => {
    const fetcher = vi
      .fn<Fetcher>()
      .mockResolvedValueOnce(page(['a'], 'C1'))
      .mockRejectedValueOnce(new Error('boom'))
    const pages = useCursorPages(fetcher, describeError)
    await pages.reload()
    await pages.next()
    expect(pages.items.value).toEqual([])
    expect(pages.problem.value).toBe('请求失败，请重试')
    expect(pages.pageNumber.value).toBe(2)
    // 退得回去：否则用户卡在一张空表上，只剩刷新一条路
    expect(pages.hasPrev.value).toBe(true)
  })
})
