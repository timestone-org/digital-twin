/**
 * @fileoverview 契约：挑点面板的搜索防竞态——关键字是连着敲出来的，
 * 先发后回的那次不许把结果覆盖成上一个关键字的。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Page } from '@dt/contracts'

import * as collectApi from '@/api/collect'
import type { CollectPoint } from '@/api/collect'
import { BizError } from '@/api/client'
import { usePointPicker } from '@/composables/usePointPicker'

function point(code: string): CollectPoint {
  return {
    id: code,
    sourceId: 's1',
    nodeKey: `s1:${code}`,
    code,
    name: `点位 ${code}`,
    dataType: 'float',
    unit: null,
  }
}

function page(items: CollectPoint[]): Page<CollectPoint> {
  return { items, total: items.length, page: 1, size: 50 }
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('搜索', () => {
  it('把关键字与数据源传给接口，空串按不筛处理', async () => {
    const list = vi
      .spyOn(collectApi, 'listPoints')
      .mockResolvedValue(page([point('t1')]))
    const picker = usePointPicker()

    await picker.search()

    expect(list.mock.calls[0]?.[0]).toMatchObject({
      q: undefined,
      sourceId: undefined,
      page: 1,
    })
    expect(picker.items.value).toHaveLength(1)
  })

  it('关键字与数据源都传下去', async () => {
    const list = vi.spyOn(collectApi, 'listPoints').mockResolvedValue(page([]))
    const picker = usePointPicker()
    picker.keyword.value = '  温度  '
    picker.sourceId.value = 's1'

    await picker.search()

    expect(list.mock.calls[0]?.[0]).toMatchObject({
      q: '温度',
      sourceId: 's1',
    })
  })

  it('乱序返回时只有最后一次能写结果', async () => {
    const slow = deferred<Page<CollectPoint>>()
    const quick = deferred<Page<CollectPoint>>()
    vi.spyOn(collectApi, 'listPoints')
      .mockReturnValueOnce(slow.promise)
      .mockReturnValueOnce(quick.promise)
    const picker = usePointPicker()

    const first = picker.search()
    const second = picker.search()
    quick.resolve(page([point('new')]))
    slow.resolve(page([point('old')]))
    await Promise.all([first, second])

    expect(picker.items.value.map((item) => item.code)).toEqual(['new'])
  })

  it('失败时清空列表并给出一句能看的话', async () => {
    vi.spyOn(collectApi, 'listPoints').mockRejectedValue(
      new BizError(40300, '没有权限', 403, 't'),
    )
    const picker = usePointPicker()

    await picker.search()

    expect(picker.items.value).toEqual([])
    expect(picker.error.value).toBe('没有权限')
    expect(picker.loading.value).toBe(false)
  })

  it('掐掉在途请求之后，那一次的失败不再写状态', async () => {
    const pending = deferred<Page<CollectPoint>>()
    vi.spyOn(collectApi, 'listPoints').mockReturnValue(
      pending.promise.then(() => {
        throw new BizError(50000, '炸了', 500, 't')
      }),
    )
    const picker = usePointPicker()

    const search = picker.search()
    picker.dispose()
    pending.resolve(page([]))
    await search

    expect(picker.error.value).toBeNull()
  })
})
