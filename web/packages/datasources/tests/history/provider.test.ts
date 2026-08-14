/**
 * @fileoverview 契约：历史 provider 走注入的取数函数，失败一律拒绝并说明原因，
 * 绝不返回空 `points` 冒充「这段时间没数据」；自相矛盾的取数条件当场说破。
 */
import type { HistoryQuery, HistoryResult } from '@dt/contracts'
import { describe, expect, it, vi } from 'vitest'

import { DataSourceError } from '../../src/errors'
import { createHistoryProvider } from '../../src/history/provider'

const RESULT: HistoryResult = {
  points: [
    { t: 1_764_000_000_000, v: 21.5 },
    { t: 1_764_000_060_000, v: 21.7 },
  ],
  isTruncated: true,
  isStale: false,
}

function query(range: HistoryQuery['range'] = {}): HistoryQuery {
  return { nodeKey: 'src-1:temp', range }
}

describe('历史序列 provider', () => {
  it('认 archive 这一种来源', () => {
    const provider = createHistoryProvider({
      fetchHistory: () => Promise.resolve(RESULT),
    })

    expect(provider.kind).toBe('archive')
  })

  it('把取数条件原样交给注入的函数并带回结果', async () => {
    const fetchHistory = vi.fn(() => Promise.resolve(RESULT))
    const provider = createHistoryProvider({ fetchHistory })
    const asked = query({ fromMs: 1, toMs: 2, limit: 10 })

    await expect(provider.readHistory(asked)).resolves.toEqual(RESULT)
    expect(fetchHistory).toHaveBeenCalledWith(asked)
  })

  it('注入的函数失败时拒绝并挂上原始错误', async () => {
    const cause = new Error('502 Bad Gateway')
    const provider = createHistoryProvider({
      fetchHistory: () => Promise.reject(cause),
    })

    await expect(provider.readHistory(query())).rejects.toMatchObject({
      code: 'fetch-failed',
      cause,
    })
  })

  it('注入的函数抛取数错误时原样传出，不再包一层', async () => {
    const error = new DataSourceError('invalid-query', '点位已删除')
    const provider = createHistoryProvider({
      fetchHistory: () => Promise.reject(error),
    })

    await expect(provider.readHistory(query())).rejects.toBe(error)
  })

  it('缺点位身份时当场拒绝，不去问后端', async () => {
    const fetchHistory = vi.fn(() => Promise.resolve(RESULT))
    const provider = createHistoryProvider({ fetchHistory })

    await expect(
      provider.readHistory({ nodeKey: '  ', range: {} }),
    ).rejects.toMatchObject({ code: 'invalid-query' })
    expect(fetchHistory).not.toHaveBeenCalled()
  })

  it('时间窗左右颠倒时当场拒绝', async () => {
    const fetchHistory = vi.fn(() => Promise.resolve(RESULT))
    const provider = createHistoryProvider({ fetchHistory })

    await expect(
      provider.readHistory(query({ fromMs: 2_000, toMs: 1_000 })),
    ).rejects.toMatchObject({ code: 'invalid-query' })
    expect(fetchHistory).not.toHaveBeenCalled()
  })

  it('limit 不是正整数时当场拒绝', async () => {
    const provider = createHistoryProvider({
      fetchHistory: () => Promise.resolve(RESULT),
    })

    await expect(
      provider.readHistory(query({ limit: 0 })),
    ).rejects.toMatchObject({ code: 'invalid-query' })
    await expect(
      provider.readHistory(query({ limit: 1.5 })),
    ).rejects.toMatchObject({ code: 'invalid-query' })
  })

  it('只给左边界或只给上限都是合法窗', async () => {
    const provider = createHistoryProvider({
      fetchHistory: () => Promise.resolve(RESULT),
    })

    await expect(provider.readHistory(query({ fromMs: 1 }))).resolves.toEqual(
      RESULT,
    )
    await expect(provider.readHistory(query({ limit: 5 }))).resolves.toEqual(
      RESULT,
    )
  })

  it('拿点位来订阅时说破这条绑定接错了来源', () => {
    const provider = createHistoryProvider({
      fetchHistory: () => Promise.resolve(RESULT),
    })

    expect(() =>
      provider.subscribe(['src-1:temp'], () => undefined),
    ).toThrowError(/没有可订阅的点位/)
  })
})
