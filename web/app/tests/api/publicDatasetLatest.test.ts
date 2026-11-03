/** @fileoverview 公开台账最新值只消费当前屏绑定列，并保持空值、精度和错误状态。 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import * as client from '@/api/client'
import {
  readPublicDatasetLatest,
  type PublicDatasetLatestItemWire,
} from '@/api/publicDatasetLatest'

const KEY = 'ds:nyyh:制丝排潮运行状态'
const TS = '2026-11-03T01:00:00Z'
const signal = new AbortController().signal

function item(
  over: Partial<PublicDatasetLatestItemWire> = {},
): PublicDatasetLatestItemWire {
  return {
    dataset_key: KEY,
    status: 'ok',
    value: 0,
    ts: TS,
    stale_at: null,
    message: null,
    ...over,
  }
}

afterEach(() => vi.restoreAllMocks())

describe('公开台账最新值映射', () => {
  it('只调用票据内的匿名端点，不带列身份查询参数', async () => {
    const request = vi
      .spyOn(client, 'requestData')
      .mockResolvedValue({ items: [item()] })

    const result = await readPublicDatasetLatest('ticket', [KEY], signal)

    expect(request).toHaveBeenCalledExactlyOnceWith(
      '/public-dashboards/ticket/dataset-latest',
      {
        baseUrl: '/api/v1/platform',
        anonymous: true,
        signal,
      },
    )
    expect(result.get(KEY)?.slot).toEqual({
      state: 'ok',
      value: 0,
      timestampMs: Date.parse(TS),
      dependsOnRealtime: false,
    })
  })

  it.each([false, '1234567890.123456789', null])(
    '保留原始值%s而不强转为数值',
    async (value) => {
      vi.spyOn(client, 'requestData').mockResolvedValue({
        items: [item({ value, ts: value === null ? null : TS })],
      })

      const result = await readPublicDatasetLatest('ticket', [KEY], signal)

      expect(result.get(KEY)?.slot).toMatchObject({ state: 'ok', value })
    },
  )

  it('保留禁用台账的epoch过期时刻，忽略未请求列', async () => {
    vi.spyOn(client, 'requestData').mockResolvedValue({
      items: [
        item({ stale_at: '1970-01-01T00:00:00Z' }),
        item({ dataset_key: 'ds:other:private' }),
      ],
    })

    const result = await readPublicDatasetLatest('ticket', [KEY], signal)

    expect(result.get(KEY)?.staleAtMs).toBe(0)
    expect([...result.keys()]).toEqual([KEY])
  })

  it('逐列失败与服务端未返回的列不会停留在旧值', async () => {
    vi.spyOn(client, 'requestData').mockResolvedValue({
      items: [
        item({ status: 'error', value: null, ts: null, message: '读数不可用' }),
      ],
    })

    const result = await readPublicDatasetLatest(
      'ticket',
      [KEY, 'ds:nyyh:missing'],
      signal,
    )

    expect(result.get(KEY)).toEqual({
      slot: { state: 'error', message: '读数不可用' },
    })
    expect(result.get('ds:nyyh:missing')?.slot.state).toBe('error')
  })

  it.each([{ ts: 'bad-date' }, { stale_at: 'bad-date' }])(
    '无效时刻明确失败：%j',
    async (over) => {
      vi.spyOn(client, 'requestData').mockResolvedValue({ items: [item(over)] })

      const result = await readPublicDatasetLatest('ticket', [KEY], signal)

      expect(result.get(KEY)?.slot).toEqual({
        state: 'error',
        message: '公开台账读数的时间格式不正确',
      })
    },
  )
})
