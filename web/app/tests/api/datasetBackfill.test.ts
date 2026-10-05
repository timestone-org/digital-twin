/** @fileoverview 历史桶回填使用真实 POST/GET/DELETE 契约；没有任务是 null。 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as client from '@/api/client'
import * as dataset from '@/api/dataset'
import { PLATFORM_BASE_URL } from '@/config/app'

afterEach(() => vi.restoreAllMocks())

describe('历史桶回填接口', () => {
  it('开始回填带 UTC 范围和独立幂等键', async () => {
    const request = vi
      .spyOn(client, 'requestData')
      .mockResolvedValue({ status: 'running' })
    const input = {
      since: '2026-01-01T00:00:00.000Z',
      until: '2026-01-02T00:00:00.000Z',
    }
    await dataset.startDatasetBackfill('t1', input, 'backfill-1')
    expect(request).toHaveBeenCalledWith('/dataset-tables/t1/backfill', {
      baseUrl: PLATFORM_BASE_URL,
      method: 'POST',
      body: input,
      headers: { 'Idempotency-Key': 'backfill-1' },
    })
  })

  it('GET 允许 null 而非当成空回执错误，并传递取消信号', async () => {
    const request = vi.spyOn(client, 'request').mockResolvedValue(null)
    const signal = new AbortController().signal
    await expect(dataset.getDatasetBackfill('t1', signal)).resolves.toBeNull()
    expect(request).toHaveBeenCalledWith('/dataset-tables/t1/backfill', {
      baseUrl: PLATFORM_BASE_URL,
      signal,
    })
  })

  it('DELETE 读取实际任务回执，并非无内容 204', async () => {
    const receipt = { status: 'running', message: 'cancellation requested' }
    const request = vi.spyOn(client, 'requestData').mockResolvedValue(receipt)
    await expect(
      dataset.cancelDatasetBackfill('t1', 'cancel-1'),
    ).resolves.toEqual(receipt)
    expect(request).toHaveBeenCalledWith('/dataset-tables/t1/backfill', {
      baseUrl: PLATFORM_BASE_URL,
      method: 'DELETE',
      headers: { 'Idempotency-Key': 'cancel-1' },
    })
  })
})
