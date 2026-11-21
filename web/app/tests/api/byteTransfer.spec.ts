// @vitest-environment node
/** @fileoverview 文件下载在收到字节时重新计时，调用者可随时取消。 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { configureApiClient, requestBytes, TransportError } from '@/api/client'
import { sameRequestOwner } from '@/api/requestOwner'

const fetchMock = vi.fn<typeof fetch>()
const chunk = new Uint8Array([65, 66])

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('fetch', fetchMock)
  vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) => {
    const controller = new AbortController()
    setTimeout(
      () => controller.abort(new DOMException('expired', 'TimeoutError')),
      ms,
    )
    return controller.signal
  })
  configureApiClient({
    getToken: () => null,
    getSessionIdentity: () => null,
    onRefresh: () => Promise.resolve(false),
    onUnauthorized: () => undefined,
  })
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  fetchMock.mockReset()
})

function responseStream(status = 200) {
  let body: ReadableStreamDefaultController<Uint8Array> | undefined
  fetchMock.mockImplementation((_input, init) => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        body = controller
        init?.signal?.addEventListener(
          'abort',
          () => controller.error(init.signal?.reason),
          { once: true },
        )
      },
    })
    return Promise.resolve(
      new Response(stream, {
        status,
        headers: { 'Content-Type': 'application/octet-stream' },
      }),
    )
  })
  return {
    next: (bytes: Uint8Array) => {
      if (!body) throw new Error('响应尚未开始')
      body.enqueue(bytes)
    },
    close: () => {
      if (!body) throw new Error('响应尚未开始')
      body.close()
    },
  }
}

it('文件每 19 秒取得字节，整段跨过 20 秒仍交付正确 Blob 和 MIME', async () => {
  const stream = responseStream()
  const result = requestBytes('/file')
  const outcome = result.catch((e: unknown) => e)
  await vi.advanceTimersByTimeAsync(0)
  for (let index = 0; index < 3; index++) {
    await vi.advanceTimersByTimeAsync(19_000)
    stream.next(chunk)
  }
  stream.close()
  const file = await outcome
  expect(file).toBeInstanceOf(Blob)
  if (!(file instanceof Blob)) throw new Error('文件没有完成')
  expect(await file.text()).toBe('ABABAB')
  expect(file.type).toBe('application/octet-stream')
  expect(vi.getTimerCount()).toBe(0)
})

it('空块不算下载进展，连续 20 秒无数据时停止传输并保留状态码', async () => {
  const stream = responseStream()
  const result = requestBytes('/file').catch((e: unknown) => e)
  await vi.advanceTimersByTimeAsync(10_000)
  stream.next(chunk)
  await vi.advanceTimersByTimeAsync(10_000)
  stream.next(new Uint8Array())
  await vi.advanceTimersByTimeAsync(10_000)
  const caught = await result
  expect(caught).toBeInstanceOf(TransportError)
  if (!(caught instanceof TransportError)) throw new Error('缺少传输错误')
  expect(caught.status).toBe(200)
  expect(caught.message).toContain('超时')
  expect(fetchMock).toHaveBeenCalledTimes(1)
})

function pendingHeaders(): void {
  fetchMock.mockImplementation(
    (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => {
            const reason: unknown = init.signal?.reason
            reject(
              reason instanceof Error
                ? reason
                : new DOMException('取消', 'AbortError'),
            )
          },
          { once: true },
        )
      }),
  )
}

it('等待响应头超过 20 秒仍会超时', async () => {
  pendingHeaders()
  const result = requestBytes('/file').catch((e: unknown) => e)
  await vi.advanceTimersByTimeAsync(20_000)
  const caught = await result
  expect(caught).toBeInstanceOf(TransportError)
  if (!(caught instanceof TransportError)) throw new Error('缺少传输错误')
  expect(caught.status).toBe(0)
})

it('调用者中止正在传输的文件，保留中止原因并释放计时器', async () => {
  const stream = responseStream()
  const caller = new AbortController()
  const result = requestBytes('/file', { signal: caller.signal }).catch(
    (e: unknown) => e,
  )
  await vi.advanceTimersByTimeAsync(0)
  stream.next(chunk)
  caller.abort()
  expect(await result).toBe(caller.signal.reason)
  expect(fetchMock).toHaveBeenCalledTimes(1)
  expect(vi.getTimerCount()).toBe(0)
})

it('取消等待共享续期的下载不会发起重放或注销，也不会阻止共享续期完成', async () => {
  let finish: (value: boolean) => void = () => undefined
  const refresh = vi.fn(
    () =>
      new Promise<boolean>((resolve) => {
        finish = resolve
      }),
  )
  const logout = vi.fn()
  configureApiClient({
    getToken: () => 'test-user',
    onRefresh: refresh,
    onUnauthorized: logout,
  })
  fetchMock.mockResolvedValue(new Response('', { status: 401 }))
  const caller = new AbortController()
  const result = requestBytes('/file', { signal: caller.signal }).catch(
    (error: unknown) => error,
  )
  await vi.advanceTimersByTimeAsync(0)
  expect(refresh).toHaveBeenCalledTimes(1)
  caller.abort()
  expect(await result).toBe(caller.signal.reason)
  finish(true)
  await vi.advanceTimersByTimeAsync(0)
  expect(fetchMock).toHaveBeenCalledTimes(1)
  expect(logout).not.toHaveBeenCalled()
  expect(vi.getTimerCount()).toBe(0)
})

it('响应体停止发送后，正常错误状态也按文件空闲超时返回', async () => {
  const stream = responseStream(403)
  const result = requestBytes('/file', { timeoutMs: 500 }).catch(
    (error: unknown) => error,
  )
  await vi.advanceTimersByTimeAsync(0)
  stream.next(new TextEncoder().encode('{'))
  await vi.advanceTimersByTimeAsync(500)
  const error = await result
  expect(error).toBeInstanceOf(TransportError)
  if (!(error instanceof TransportError)) throw new Error('缺少传输错误')
  expect(error.status).toBe(403)
  expect(error.message).toContain('超时')
})

it('调用方在收到响应前取消，保留真实中止原因', async () => {
  pendingHeaders()
  const caller = new AbortController()
  const result = requestBytes('/file', { signal: caller.signal }).catch(
    (error: unknown) => error,
  )
  caller.abort()
  expect(await result).toBe(caller.signal.reason)
  expect(vi.getTimerCount()).toBe(0)
})

it('只允许原会话主体在续期后继续读取文件', () => {
  const original = { session: 'session-a', token: 'original' }
  expect(
    sameRequestOwner(original, { session: 'session-a', token: 'renewed' }),
  ).toBe(true)
  expect(
    sameRequestOwner(original, { session: 'session-b', token: 'renewed' }),
  ).toBe(false)
  expect(sameRequestOwner(original, { session: null, token: null })).toBe(false)
  expect(
    sameRequestOwner(
      { session: null, token: 'original' },
      { session: null, token: 'original' },
    ),
  ).toBe(true)
  expect(
    sameRequestOwner(
      { session: null, token: 'original' },
      { session: 'session-a', token: 'renewed' },
    ),
  ).toBe(false)
})

it('同一真实主体的令牌轮换一次后，文件读取恢复', async () => {
  let token = 'before'
  configureApiClient({
    getToken: () => token,
    getSessionIdentity: () => 'session-a',
    onRefresh: () => {
      token = 'after'
      return Promise.resolve(true)
    },
  })
  fetchMock
    .mockResolvedValueOnce(new Response('', { status: 401 }))
    .mockResolvedValueOnce(new Response('document'))
  const result = await requestBytes('/file')
  expect(await result.text()).toBe('document')
  expect(fetchMock).toHaveBeenCalledTimes(2)
  expect(vi.getTimerCount()).toBe(0)
})
