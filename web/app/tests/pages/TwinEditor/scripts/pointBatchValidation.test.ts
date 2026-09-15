/** @fileoverview 批量替换按完整点位身份校验，缺失或未确认时不放行。 */
import type { CollectPoint } from '@dt/contracts'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { listPoints } from '@/api/collect'
import { validateReplacementPoints } from '@/pages/TwinEditor/scripts/pointBatchValidation'
vi.mock('@/api/collect', () => ({ listPoints: vi.fn() }))
const SOURCE = '0192f0aa-0000-7000-8000-000000000001'
function point(code: string): CollectPoint {
  return {
    id: 'point',
    source_id: SOURCE,
    node_key: `${SOURCE}:${code}`,
    code,
    name: `点位${code}`,
    address: code,
    data_type: 'float',
    unit: '',
    sampling_interval_ms: 1000,
    deadband: 0,
    archive_enabled: false,
    archive_max_interval_ms: 60000,
    archive_retention_days: null,
    created_at: '',
    updated_at: '',
  }
}
beforeEach(() => vi.mocked(listPoints).mockReset())
describe('目标校验', () => {
  it('去重并确认完整身份，不把相似编码当作目标', async () => {
    vi.mocked(listPoints).mockResolvedValue({
      items: [point('T20'), point('T2')],
      page: 1,
      size: 100,
      total: 2,
    })
    const result = await validateReplacementPoints(
      [`${SOURCE}:T2`, `${SOURCE}:T2`],
      new AbortController().signal,
    )
    expect(result).toEqual([
      { key: `${SOURCE}:T2`, valid: true, message: '点位T2' },
    ])
    expect(listPoints).toHaveBeenCalledTimes(1)
    expect(listPoints).toHaveBeenCalledWith(
      { sourceId: SOURCE, q: 'T2', page: 1, size: 100 },
      expect.any(AbortSignal),
    )
  })
  it('无法识别和不存在的点位均不通过', async () => {
    vi.mocked(listPoints).mockResolvedValue({
      items: [],
      page: 1,
      size: 100,
      total: 0,
    })
    const result = await validateReplacementPoints(
      ['bad', `${SOURCE}:`, `${SOURCE}:missing`],
      new AbortController().signal,
    )
    expect(result.map((item) => item.valid)).toEqual([false, false, false])
    expect(result[2]?.message).toBe('目标点位不存在')
  })
  it('匹配结果过多时报告未能确认，而不是误报不存在', async () => {
    vi.mocked(listPoints).mockResolvedValue({
      items: [point('T20')],
      page: 1,
      size: 100,
      total: 600,
    })
    const result = await validateReplacementPoints(
      [`${SOURCE}:T2`],
      new AbortController().signal,
    )
    expect(result[0]?.message).toContain('无法确认')
    expect(listPoints).toHaveBeenCalledTimes(5)
  })
  it('关闭时取消请求，超过上限不发请求', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      validateReplacementPoints([`${SOURCE}:T2`], controller.signal),
    ).rejects.toThrow()
    await expect(
      validateReplacementPoints(
        Array.from({ length: 201 }, (_, index) => `${SOURCE}:T${index}`),
        new AbortController().signal,
      ),
    ).rejects.toThrow('200')
    expect(listPoints).not.toHaveBeenCalled()
  })
})
