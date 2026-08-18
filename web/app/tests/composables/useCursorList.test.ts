/**
 * @fileoverview 锁住游标翻页：首屏替换、追加不覆盖、游标原样带回、
 * 取数中不重复发起。
 * ⚠ 「追加」写成「替换」时界面看着还在翻页，只是永远只有最后一页。
 */
import { describe, expect, it, vi } from 'vitest'
import type { CursorPage } from '@dt/contracts'

import { BizError } from '@/api/client'
import { describeAcDataError } from '@/pages/Hvac/AcData/scripts/acDataError'
import { useCursorList } from '@/composables/useCursorList'

function page(items: string[], next: string | null = null): CursorPage<string> {
  return { items, next, has_more: next !== null }
}

describe('useCursorList', () => {
  it('首屏替换整份列表，并记下有没有下一页', async () => {
    const list = useCursorList(
      () => Promise.resolve(page(['a'], 'C1')),
      describeAcDataError,
    )
    await list.reload()
    expect(list.items.value).toEqual(['a'])
    expect(list.hasMore.value).toBe(true)
  })

  it('加载更多是追加，不是替换', async () => {
    const fetcher = vi
      .fn<(after: string | null) => Promise<CursorPage<string>>>()
      .mockResolvedValueOnce(page(['a'], 'C1'))
      .mockResolvedValueOnce(page(['b']))
    const list = useCursorList(fetcher, describeAcDataError)
    await list.reload()
    await list.loadMore()
    expect(list.items.value).toEqual(['a', 'b'])
    expect(list.hasMore.value).toBe(false)
  })

  it('游标原样带回去当 after，一个字符都不动', async () => {
    const fetcher = vi
      .fn<(after: string | null) => Promise<CursorPage<string>>>()
      .mockResolvedValueOnce(page(['a'], 'eyJ0cyI6ICIyMDI2In0='))
      .mockResolvedValueOnce(page(['b']))
    const list = useCursorList(fetcher, describeAcDataError)
    await list.reload()
    await list.loadMore()
    expect(fetcher.mock.calls[0]?.[0]).toBeNull()
    expect(fetcher.mock.calls[1]?.[0]).toBe('eyJ0cyI6ICIyMDI2In0=')
  })

  it('没有下一页时点不出请求', async () => {
    const fetcher = vi
      .fn<(after: string | null) => Promise<CursorPage<string>>>()
      .mockResolvedValue(page(['a']))
    const list = useCursorList(fetcher, describeAcDataError)
    await list.reload()
    await list.loadMore()
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('上一次追加还没回来时不重复发起——连点两下只该取一页', async () => {
    const fetcher = vi
      .fn<(after: string | null) => Promise<CursorPage<string>>>()
      .mockResolvedValueOnce(page(['a'], 'C1'))
      .mockReturnValueOnce(new Promise(() => undefined))
    const list = useCursorList(fetcher, describeAcDataError)
    await list.reload()
    void list.loadMore()
    await list.loadMore()
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('失败时清空列表并记下原因，不留着上一段的行冒充新数据', async () => {
    const fetcher = vi
      .fn<(after: string | null) => Promise<CursorPage<string>>>()
      .mockResolvedValueOnce(page(['a'], 'C1'))
      .mockRejectedValueOnce(new BizError(51601, '外部数据源不可用', 503, 't'))
    const list = useCursorList(fetcher, describeAcDataError)
    await list.reload()
    await list.reload()
    expect(list.items.value).toEqual([])
    expect(list.hasMore.value).toBe(false)
    expect(list.problem.value?.kind).toBe('unavailable')
  })
})
