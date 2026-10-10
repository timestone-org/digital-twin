/** @fileoverview 点位搜索的候选数量、数据源与取消信号请求契约。 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as client from '@/api/client'
import { searchCollectPoints } from '@/api/collectSearch'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('搜索请求', () => {
  it('对话调用未指定数量时仍请求6个候选', async () => {
    const request = vi.spyOn(client, 'requestData').mockResolvedValue({
      items: [],
      mode: 'keyword',
      pending_count: 0,
    })
    await searchCollectPoints('温度')
    expect(request).toHaveBeenCalledWith('/collect-point-matches', {
      baseUrl: '/api/v1/platform',
      query: { q: '温度', source_id: undefined, limit: 6 },
      signal: undefined,
    })
  })

  it.each([20, 40, 60, 80, 100])(
    '请求%d个候选时透传数量与筛选条件',
    async (limit) => {
      const request = vi.spyOn(client, 'requestData').mockResolvedValue({
        items: [],
        mode: 'hybrid',
        pending_count: 0,
      })
      const signal = new AbortController().signal
      await searchCollectPoints('水箱温度', 's1', signal, limit)
      expect(request).toHaveBeenCalledWith('/collect-point-matches', {
        baseUrl: '/api/v1/platform',
        query: { q: '水箱温度', source_id: 's1', limit },
        signal,
      })
    },
  )
})
