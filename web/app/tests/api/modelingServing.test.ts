/** @fileoverview 当前账号的线上签名与三类试算请求契约。 */
import { beforeEach, expect, it, vi } from 'vitest'
import { requestData } from '@/api/client'
import { callOpenModel, getOpenModelSignature } from '@/api/modelingServing'

vi.mock('@/api/client', () => ({ requestData: vi.fn().mockResolvedValue({}) }))
beforeEach(() => vi.clearAllMocks())

it('读取公开签名只使用当前会话并携带取消信号', async () => {
  const signal = new AbortController().signal
  await getOpenModelSignature('energy-model', signal)
  expect(requestData).toHaveBeenCalledWith('/open-models/energy-model', {
    baseUrl: '/api/v1/platform',
    signal,
  })
})

it.each(['predict', 'detect', 'calculate'] as const)(
  '试算使用 %s 端点与 rows 请求体',
  async (action) => {
    const signal = new AbortController().signal
    const rows = [{ temperature: 26, label: 'A', load: null }]
    await callOpenModel('energy-model', action, rows, signal)
    expect(requestData).toHaveBeenCalledWith(
      `/open-models/energy-model:${action}`,
      {
        baseUrl: '/api/v1/platform',
        method: 'POST',
        body: { rows },
        signal,
      },
    )
  },
)
