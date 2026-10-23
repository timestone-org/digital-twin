/** @fileoverview 全量帧下载经统一字节客户端携带认证，不把令牌放进地址。 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { configureApiClient } from '@/api/client'
import * as modeling from '@/api/modeling'

const fetcher = vi.fn<typeof fetch>()

beforeEach(() => {
  fetcher.mockReset()
  vi.stubGlobal('fetch', fetcher)
  configureApiClient({
    getToken: () => 'model-download-token',
    onRefresh: () => Promise.resolve(false),
    onUnauthorized: () => undefined,
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  configureApiClient({ getToken: () => null })
})

describe('建模帧的认证下载', () => {
  it('从 platform 取 CSV 字节，认证只在请求头中', async () => {
    fetcher.mockResolvedValue(
      new Response('功率,能耗\n1,2\n', {
        headers: { 'Content-Type': 'text/csv; charset=utf-8' },
      }),
    )
    const blob = await modeling.readModelingFrame({
      runId: 'run',
      nodeId: 'node',
      port: 'frame',
    })
    expect(await blob.text()).toBe('功率,能耗\n1,2\n')
    const sent = fetcher.mock.calls[0]
    expect(sent?.[0]).toBe(
      '/api/v1/platform/modeling-runs/run/frames/node?port=frame',
    )
    expect(new Headers(sent?.[1]?.headers).get('Authorization')).toBe(
      'Bearer model-download-token',
    )
    expect(sent?.[0]).not.toContain('model-download-token')
  })
})
