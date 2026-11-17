/** @fileoverview 最新报告选择只使用成功记录，并正确分页和过滤。 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { findLatestReport } from '@/features/reports/scripts/latestReport'

const api = vi.hoisted(() => ({
  listReportChoices: vi.fn(),
  listReportRenders: vi.fn(),
}))
vi.mock('@/api/reports', () => api)
beforeEach(() => vi.resetAllMocks())

describe('最新成功报告', () => {
  it('按模板过滤，越过未完成和导入记录', async () => {
    api.listReportChoices.mockResolvedValue([
      { id: 't', code: 'green', name: '绿色生产月报' },
    ])
    api.listReportRenders
      .mockResolvedValueOnce({
        items: [
          { id: 'p', status: 'pending', kind: 'render' },
          { id: 'i', status: 'succeeded', kind: 'import' },
        ],
        has_more: true,
        next: 'next',
      })
      .mockResolvedValueOnce({
        items: [{ id: 'old', status: 'succeeded', kind: 'render' }],
        has_more: false,
        next: null,
      })
    const signal = new AbortController().signal
    const result = await findLatestReport('green', signal)
    expect(result?.record.id).toBe('old')
    expect(result?.name).toBe('绿色生产月报')
    expect(api.listReportRenders).toHaveBeenLastCalledWith('next', 't', signal)
  })
  it('没有成功记录为空，有编码但找不到模板时报错', async () => {
    api.listReportRenders.mockResolvedValue({
      items: [],
      next: null,
      has_more: false,
    })
    expect(await findLatestReport('', new AbortController().signal)).toBeNull()
    api.listReportChoices.mockResolvedValue([])
    await expect(
      findLatestReport('missing', new AbortController().signal),
    ).rejects.toThrow('未找到报告模板')
  })
  it('中止后不再请求记录', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(findLatestReport('', controller.signal)).rejects.toThrow()
    expect(api.listReportRenders).not.toHaveBeenCalled()
  })
})
