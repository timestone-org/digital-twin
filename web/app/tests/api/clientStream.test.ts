/**
 * @fileoverview 契约：事件流那条路。
 *
 * 它与一问一答那条**刻意不同**，三处：不走统一信封（流一开就没法改状态码）、
 * 不套 20 秒超时（一次模型回合可能跑几分钟）、以及 abort **不是**网络故障
 * （调用方卸载时 abort 是常态，当成网络错会在界面上弹「无法连接服务器」）。
 *
 * ⚠ 收尾必须 cancel reader：不 cancel 的话调用方 abort 之后底层连接仍挂着，
 * 服务端那边的回合会一直跑到自己结束。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { TransportError, configureApiClient, openStream } from '@/api/client'

function streaming(chunks: string[], status = 200): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder()
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
  return new Response(status === 200 ? body : null, { status })
}

async function collect(stream: AsyncGenerator<string>): Promise<string[]> {
  const seen: string[] = []
  for await (const chunk of stream) seen.push(chunk)
  return seen
}

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

describe('开流', () => {
  it('逐块交出去', async () => {
    fetchMock.mockResolvedValue(streaming(['event: step\n', 'data: {}\n\n']))
    const seen = await collect(openStream('/x:advance'))
    expect(seen.join('')).toBe('event: step\ndata: {}\n\n')
  })

  it('是 POST，带令牌，且声明只收事件流', async () => {
    fetchMock.mockResolvedValue(streaming(['a']))
    await collect(openStream('/x:advance', { body: { q: 1 } }))
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.method).toBe('POST')
    expect(init.body).toBe('{"q":1}')
    const headers = init.headers as Record<string, string>
    expect(headers.Accept).toBe('text/event-stream')
    expect(headers.Authorization).toBe('Bearer tok')
  })

  it('按 baseUrl 打到对应的服务上', async () => {
    fetchMock.mockResolvedValue(streaming(['a']))
    await collect(openStream('/x:advance', { baseUrl: '/api/v1/assistant' }))
    // 漏了 baseUrl 会静默打到 auth-server 上，现象是「助手永远说不出话」
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/v1/assistant/x:advance')
  })
})

describe('开不起来的时候', () => {
  it('非 2xx 一律抛传输错，而不是交出一段空流', async () => {
    fetchMock.mockResolvedValue(streaming([], 500))
    await expect(collect(openStream('/x:advance'))).rejects.toBeInstanceOf(
      TransportError,
    )
  })

  it('401 先刷新再重来一次', async () => {
    configureApiClient({ onRefresh: () => Promise.resolve(true) })
    fetchMock
      .mockResolvedValueOnce(streaming([], 401))
      .mockResolvedValueOnce(streaming(['ok']))
    expect(await collect(openStream('/x:advance'))).toEqual(['ok'])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('刷不动就交给登出钩子，并把 401 如实抛出去', async () => {
    const onUnauthorized = vi.fn()
    configureApiClient({
      onRefresh: () => Promise.resolve(false),
      onUnauthorized,
    })
    fetchMock.mockResolvedValue(streaming([], 401))
    await expect(collect(openStream('/x:advance'))).rejects.toBeInstanceOf(
      TransportError,
    )
    expect(onUnauthorized).toHaveBeenCalledTimes(1)
  })

  it('连不上是传输错，不是一段空流', async () => {
    fetchMock.mockRejectedValue(new TypeError('failed to fetch'))
    await expect(collect(openStream('/x:advance'))).rejects.toBeInstanceOf(
      TransportError,
    )
  })

  it('中止**原样抛 AbortError**，不当成网络故障', async () => {
    // 当成网络错的话，用户只是关掉面板，界面上却弹一条「无法连接服务器」
    fetchMock.mockRejectedValue(new DOMException('aborted', 'AbortError'))
    await expect(collect(openStream('/x:advance'))).rejects.toThrow(/aborted/)
  })
})
