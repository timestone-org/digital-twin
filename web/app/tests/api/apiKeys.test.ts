/**
 * @fileoverview API 密钥接口封装：URL、方法与 query 的形状。
 *
 * ⚠ 动作端点是 `:revoke` 不是 DELETE——后端只吊销不删行，写错方法会 405，
 * 而这类错误在页面上表现为「点了没反应」。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import * as apiKeys from '@/api/apiKeys'

function stubFetch(data: unknown): ReturnType<typeof vi.fn> {
  const fetchMock = vi
    .fn()
    .mockResolvedValue(
      new Response(
        JSON.stringify({ code: 0, message: 'ok', data, trace_id: 't' }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function calledUrl(fetchMock: ReturnType<typeof vi.fn>): string {
  return String(fetchMock.mock.calls[0]?.[0])
}

function calledInit(
  fetchMock: ReturnType<typeof vi.fn>,
): RequestInit | undefined {
  return fetchMock.mock.calls[0]?.[1] as RequestInit | undefined
}

/** 请求体。client 一律 JSON.stringify 之后再发，故这里必然是字符串。 */
function calledBody(fetchMock: ReturnType<typeof vi.fn>): string {
  const body = calledInit(fetchMock)?.body
  return typeof body === 'string' ? body : ''
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('API 密钥接口', () => {
  it('列表打 /api-keys 并把筛选拼进 query', async () => {
    const fetchMock = stubFetch({ items: [], page: 1, size: 20, total: 0 })
    await apiKeys.listApiKeys({
      user_id: 'u1',
      should_include_revoked: true,
      page: 2,
    })
    const url = calledUrl(fetchMock)
    expect(url).toContain('/api-keys')
    expect(url).toContain('user_id=u1')
    expect(url).toContain('should_include_revoked=true')
    expect(url).toContain('page=2')
  })

  it('undefined 的筛选不进 query——`?x=undefined` 在后端是个字符串', async () => {
    const fetchMock = stubFetch({ items: [], page: 1, size: 20, total: 0 })
    await apiKeys.listApiKeys({ should_include_revoked: undefined })
    expect(calledUrl(fetchMock)).not.toContain('should_include_revoked')
  })

  it('签发是 POST，且 expires_in_days 原样送出（null 要送出去）', async () => {
    const fetchMock = stubFetch({ api_key: {}, secret: 'dtk_x_y' })
    await apiKeys.issueApiKey({
      user_id: 'u1',
      name: '第三方',
      expires_in_days: null,
    })
    expect(calledInit(fetchMock)?.method).toBe('POST')
    expect(calledBody(fetchMock)).toContain('"expires_in_days":null')
  })

  it('吊销走 `:revoke` 动作端点，不是 DELETE', async () => {
    const fetchMock = stubFetch({ id: 'k1' })
    await apiKeys.revokeApiKey('k1')
    expect(calledUrl(fetchMock)).toContain('/api-keys/k1:revoke')
    expect(calledInit(fetchMock)?.method).toBe('POST')
  })
})
