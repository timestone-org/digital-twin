/** @fileoverview 点位智能搜索逐批扩展、上限、重试和取消竞态的行为契约。 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PointMatchOut, PointMatchesOut } from '@dt/contracts'
import * as collectApi from '@/api/collect'
import * as searchApi from '@/api/collectSearch'
import { BizError } from '@/api/client'
import { usePointPicker } from '@/composables/usePointPicker'

function candidate(index: number, prefix = '温度'): PointMatchOut {
  return {
    id: `${prefix}-${index}`,
    node_key: `s1:${prefix}-${index}`,
    code: `${prefix}-${index}`,
    name: `${prefix} ${index}`,
    source_id: 's1',
    source_name: '能源站',
    source_protocol: 'modbus_tcp',
    description: '设备温度',
    unit: '℃',
    is_enabled: true,
    is_exact: false,
    score: 0.9,
  }
}

function matches(count: number, prefix = '温度'): PointMatchesOut {
  return {
    items: Array.from({ length: count }, (_, index) =>
      candidate(index, prefix),
    ),
    mode: 'hybrid',
    pending_count: 0,
  }
}

function deferred<TResult>() {
  let resolve: (value: TResult) => void = () => undefined
  let reject: (reason: unknown) => void = () => undefined
  const promise = new Promise<TResult>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

function picker() {
  const result = usePointPicker(true)
  result.keyword.value = '  温度  '
  result.sourceId.value = 's1'
  return result
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('智能搜索显示更多', () => {
  it('首批显示二十个候选，显示更多扩展为四十个且不伪造总数', async () => {
    const search = vi
      .spyOn(searchApi, 'searchCollectPoints')
      .mockResolvedValueOnce(matches(20))
      .mockResolvedValueOnce(matches(40))
    const state = picker()

    await state.search()
    expect(state.matches.value?.items).toHaveLength(20)
    expect(state.canLoadMore.value).toBe(true)
    expect(state.total.value).toBe(0)
    expect(state.hasMore.value).toBe(false)

    await state.loadMore()

    expect(search.mock.calls.map((call) => call[3])).toEqual([20, 40])
    expect(state.matches.value?.items).toHaveLength(40)
    expect(state.matches.value?.items.at(-1)?.code).toBe('温度-39')
    expect(state.total.value).toBe(0)
  })

  it.each([0, 1, 19])('仅返回 %i 个候选时不再请求更多', async (count) => {
    const search = vi
      .spyOn(searchApi, 'searchCollectPoints')
      .mockResolvedValue(matches(count))
    const state = picker()

    await state.search()
    await state.loadMore()

    expect(state.matches.value?.items).toHaveLength(count)
    expect(state.canLoadMore.value).toBe(false)
    expect(state.isSearchLimitReached.value).toBe(false)
    expect(search).toHaveBeenCalledTimes(1)
  })

  it('达到一百个候选时标记上限并停止扩展请求', async () => {
    const search = vi
      .spyOn(searchApi, 'searchCollectPoints')
      .mockImplementation((_query, _sourceId, _signal, limit) =>
        Promise.resolve(matches(limit ?? 6)),
      )
    const state = picker()

    await state.search()
    await state.loadMore()
    await state.loadMore()
    await state.loadMore()
    await state.loadMore()
    await state.loadMore()

    expect(search.mock.calls.map((call) => call[3])).toEqual([
      20, 40, 60, 80, 100,
    ])
    expect(state.matches.value?.items).toHaveLength(100)
    expect(state.canLoadMore.value).toBe(false)
    expect(state.isSearchLimitReached.value).toBe(true)
  })

  it('扩展结果少于请求数量时停止扩展并保留服务端降级说明', async () => {
    vi.spyOn(searchApi, 'searchCollectPoints')
      .mockResolvedValueOnce(matches(20))
      .mockResolvedValueOnce({
        ...matches(30),
        mode: 'keyword',
        pending_count: 3,
        note: '有3个点位正在等待语义索引',
      })
    const state = picker()

    await state.search()
    await state.loadMore()

    expect(state.matches.value?.items).toHaveLength(30)
    expect(state.canLoadMore.value).toBe(false)
    expect(state.isSearchLimitReached.value).toBe(false)
    expect(state.matches.value?.mode).toBe('keyword')
    expect(state.matches.value?.pending_count).toBe(3)
    expect(state.matches.value?.note).toBe('有3个点位正在等待语义索引')
  })

  it('输入尚未提交时显示更多仍扩展最近成功的描述与数据源', async () => {
    const search = vi
      .spyOn(searchApi, 'searchCollectPoints')
      .mockResolvedValue(matches(20))
    const state = picker()
    await state.search()
    state.keyword.value = '压力'
    state.sourceId.value = 's2'
    state.semantic.value = false

    await state.loadMore()

    expect(search).toHaveBeenLastCalledWith(
      '温度',
      's1',
      expect.any(AbortSignal),
      40,
    )
    expect(state.matches.value?.items).toHaveLength(20)
  })

  it.each(['描述', '数据源', '搜索模式'])(
    '提交新的%s搜索时重置候选批次',
    async (change) => {
      const search = vi
        .spyOn(searchApi, 'searchCollectPoints')
        .mockImplementation((_query, _sourceId, _signal, limit) =>
          Promise.resolve(matches(limit ?? 6)),
        )
      const list = vi.spyOn(collectApi, 'listPoints').mockResolvedValue({
        items: [],
        total: 125,
        page: 1,
        size: 50,
      })
      const state = picker()
      await state.search()
      await state.loadMore()
      if (change === '描述') state.keyword.value = '压力'
      if (change === '数据源') state.sourceId.value = 's2'
      if (change === '搜索模式') state.semantic.value = false

      await state.search()

      if (change === '搜索模式') {
        expect(state.matches.value).toBeNull()
        expect(state.canLoadMore.value).toBe(false)
        expect(state.hasMore.value).toBe(true)
        expect(list).toHaveBeenCalledWith(
          expect.objectContaining({ q: '温度', sourceId: 's1' }),
          expect.any(AbortSignal),
        )
        state.semantic.value = true
        await state.search()
      }
      expect(search.mock.calls.at(-1)?.[3]).toBe(20)
      expect(state.matches.value?.items).toHaveLength(20)
      expect(state.isSearchLimitReached.value).toBe(false)
    },
  )

  it('显示更多失败时保留原候选，同样数量重试成功后清除错误', async () => {
    const search = vi
      .spyOn(searchApi, 'searchCollectPoints')
      .mockResolvedValueOnce(matches(20))
      .mockRejectedValueOnce(new BizError(50000, '搜索暂时不可用', 500, 't'))
      .mockResolvedValueOnce(matches(40))
    const state = picker()
    await state.search()

    await state.loadMore()
    expect(state.matches.value?.items).toHaveLength(20)
    expect(state.error.value).toBe('搜索暂时不可用')
    expect(state.loading.value).toBe(false)
    expect(state.canLoadMore.value).toBe(true)

    await state.loadMore()

    expect(search.mock.calls.map((call) => call[3])).toEqual([20, 40, 40])
    expect(state.matches.value?.items).toHaveLength(40)
    expect(state.error.value).toBeNull()
  })

  it('显示更多在途时保留候选，重复操作不额外发起请求', async () => {
    const pending = deferred<PointMatchesOut>()
    const search = vi
      .spyOn(searchApi, 'searchCollectPoints')
      .mockResolvedValueOnce(matches(20))
      .mockReturnValueOnce(pending.promise)
    const state = picker()
    await state.search()

    const more = state.loadMore()
    await state.loadMore()
    expect(state.loading.value).toBe(true)
    expect(state.matches.value?.items).toHaveLength(20)
    expect(search).toHaveBeenCalledTimes(2)
    pending.resolve(matches(40))
    await more

    expect(state.loading.value).toBe(false)
    expect(state.matches.value?.items).toHaveLength(40)
  })

  it('新的搜索中止旧扩展请求，旧响应晚到也不覆盖新候选', async () => {
    const pending = deferred<PointMatchesOut>()
    const search = vi
      .spyOn(searchApi, 'searchCollectPoints')
      .mockResolvedValueOnce(matches(20))
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(matches(20, '压力'))
    const state = picker()
    await state.search()
    const more = state.loadMore()
    state.keyword.value = '压力'

    await state.search()
    expect(search.mock.calls[1]?.[2]?.aborted).toBe(true)
    pending.resolve({ ...matches(40), mode: 'keyword', note: '旧查询降级' })
    await more

    expect(state.matches.value?.items[0]?.code).toBe('压力-0')
    expect(state.matches.value?.items).toHaveLength(20)
    expect(state.matches.value?.mode).toBe('hybrid')
    expect(state.matches.value?.note).toBeUndefined()
    expect(state.loading.value).toBe(false)
  })

  it.each(['成功', '失败'])(
    '关闭后中止显示更多，后续%s不再写回状态',
    async (outcome) => {
      const pending = deferred<PointMatchesOut>()
      const search = vi
        .spyOn(searchApi, 'searchCollectPoints')
        .mockResolvedValueOnce(matches(20))
        .mockReturnValueOnce(pending.promise)
      const state = picker()
      await state.search()
      const more = state.loadMore()

      state.dispose()
      expect(search.mock.calls[1]?.[2]?.aborted).toBe(true)
      expect(state.loading.value).toBe(false)
      if (outcome === '成功') pending.resolve(matches(40))
      else pending.reject(new BizError(50000, '旧扩展失败', 500, 't'))
      await more

      expect(state.matches.value?.items).toHaveLength(20)
      expect(state.error.value).toBeNull()
    },
  )
})
