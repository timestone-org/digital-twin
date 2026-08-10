/**
 * @fileoverview 锁住 HTTP 客户端的三条口径：信封解包、401 先刷新再重试一次、
 * 传输层错误与业务错误分开。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  BizError,
  TransportError,
  configureApiClient,
  request,
  requestData,
} from '@/api/client'

function envelope(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const ok = { code: 0, message: 'ok', data: { id: 1 }, trace_id: 't1' }

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  configureApiClient({
    getToken: () => 'tok',
    onRefresh: () => Promise.resolve(false),
    onUnauthorized: () => undefined,
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('request', () => {
  it('解包信封只返回 data', async () => {
    fetchMock.mockResolvedValue(envelope(ok))
    await expect(request('/x')).resolves.toEqual({ id: 1 })
  })

  it('请求打到 auth 前缀上', async () => {
    fetchMock.mockResolvedValue(envelope(ok))
    await request('/sessions')
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/v1/auth/sessions')
  })

  it('注入 Bearer 令牌', async () => {
    fetchMock.mockResolvedValue(envelope(ok))
    await request('/x')
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer tok',
    )
  })

  it('anonymous 时不注入令牌', async () => {
    fetchMock.mockResolvedValue(envelope(ok))
    await request('/x', { anonymous: true })
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect(
      (init.headers as Record<string, string>).Authorization,
    ).toBeUndefined()
  })

  it('query 里的 undefined 被丢掉', async () => {
    fetchMock.mockResolvedValue(envelope(ok))
    await request('/x', { query: { a: 1, b: undefined } })
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/v1/auth/x?a=1')
  })

  it('204 返回 null 而不是尝试解 JSON', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))
    await expect(request('/x', { method: 'DELETE' })).resolves.toBeNull()
  })

  it('非 2xx 抛 BizError 并带上错误码与 trace', async () => {
    fetchMock.mockResolvedValue(
      envelope(
        { code: 40106, message: '没有权限', data: null, trace_id: 'tr' },
        403,
      ),
    )
    await expect(request('/x')).rejects.toMatchObject({
      name: 'BizError',
      code: 40106,
      status: 403,
      traceId: 'tr',
    })
  })

  it('HTTP 200 但信封 code 非 0 同样是业务错误', async () => {
    fetchMock.mockResolvedValue(
      envelope({ code: 40001, message: '参数错', data: null, trace_id: 't' }),
    )
    await expect(request('/x')).rejects.toBeInstanceOf(BizError)
  })

  it('响应不是 JSON 时抛 TransportError', async () => {
    fetchMock.mockResolvedValue(new Response('<html>', { status: 502 }))
    await expect(request('/x')).rejects.toBeInstanceOf(TransportError)
  })

  it('网络不可达时抛 TransportError', async () => {
    fetchMock.mockRejectedValue(new TypeError('failed'))
    await expect(request('/x')).rejects.toMatchObject({
      name: 'TransportError',
      status: 0,
    })
  })

  it('401 时先刷新再重试一次，成功则返回重试的结果', async () => {
    const onRefresh = vi.fn().mockResolvedValue(true)
    configureApiClient({ onRefresh })
    fetchMock
      .mockResolvedValueOnce(
        envelope(
          { code: 40102, message: '过期', data: null, trace_id: 't' },
          401,
        ),
      )
      .mockResolvedValueOnce(envelope(ok))
    await expect(request('/x')).resolves.toEqual({ id: 1 })
    expect(onRefresh).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('刷新失败才触发登出，且不再重试', async () => {
    const onUnauthorized = vi.fn()
    configureApiClient({
      onRefresh: () => Promise.resolve(false),
      onUnauthorized,
    })
    fetchMock.mockResolvedValue(
      envelope(
        { code: 40102, message: '过期', data: null, trace_id: 't' },
        401,
      ),
    )
    await expect(request('/x')).rejects.toBeInstanceOf(BizError)
    expect(onUnauthorized).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('anonymous 的 401 不触发刷新，避免刷新自身递归', async () => {
    const onRefresh = vi.fn()
    configureApiClient({ onRefresh })
    fetchMock.mockResolvedValue(
      envelope(
        { code: 40101, message: '密码错', data: null, trace_id: 't' },
        401,
      ),
    )
    await expect(request('/x', { anonymous: true })).rejects.toBeInstanceOf(
      BizError,
    )
    expect(onRefresh).not.toHaveBeenCalled()
  })
})

describe('信封校验', () => {
  it('不是信封形状的 JSON 一律判格式异常', async () => {
    // 反代挂掉时会返回别的形状的 JSON；放它进业务层就会崩在深层组件里
    fetchMock.mockResolvedValue(envelope({ detail: 'Not Found' }, 404))
    await expect(request('/x')).rejects.toBeInstanceOf(TransportError)
  })

  it('响应根本不是 JSON 时也判格式异常', async () => {
    fetchMock.mockResolvedValue(
      new Response('<html>502</html>', { status: 502 }),
    )
    await expect(request('/x')).rejects.toThrow('服务端响应格式异常')
  })

  it('缺 trace_id 的响应不算信封——链路 id 是必填项', async () => {
    fetchMock.mockResolvedValue(envelope({ code: 0, message: 'ok', data: {} }))
    await expect(request('/x')).rejects.toBeInstanceOf(TransportError)
  })
})

describe('requestData', () => {
  it('有 data 时原样返回', async () => {
    fetchMock.mockResolvedValue(envelope(ok))
    await expect(requestData('/x')).resolves.toEqual({ id: 1 })
  })

  it('204 无 body 时报错，而不是把 null 当对象往下传', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))
    await expect(requestData('/x')).rejects.toThrow('服务端未返回数据')
  })

  it('信封里 data 是 null 时同样报错', async () => {
    fetchMock.mockResolvedValue(envelope({ ...ok, data: null }))
    await expect(requestData('/x')).rejects.toBeInstanceOf(TransportError)
  })
})
