/**
 * @fileoverview 锁住知识库对话每个端点的路径与前缀。
 *
 * ⚠ 前缀漏了会静默打到 auth 前缀上，拿回来的是一个 403 的 HTML 页。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as client from '@/api/client'
import * as api from '@/api/knowledgeChat'

const PREFIX = '/api/v1/knowledge'

let requestData: ReturnType<typeof vi.fn>
let request: ReturnType<typeof vi.fn>
let openStream: ReturnType<typeof vi.fn>

beforeEach(() => {
  requestData = vi.fn().mockResolvedValue({ items: [] })
  request = vi.fn().mockResolvedValue(null)
  openStream = vi.fn()
  vi.spyOn(client, 'requestData').mockImplementation(requestData)
  vi.spyOn(client, 'request').mockImplementation(request)
  vi.spyOn(client, 'openStream').mockImplementation(openStream)
})

afterEach(() => {
  vi.restoreAllMocks()
})

function lastCall(
  spy: ReturnType<typeof vi.fn>,
): [string, Record<string, unknown>] {
  const args = spy.mock.calls.at(-1)
  return [args?.[0] as string, (args?.[1] ?? {}) as Record<string, unknown>]
}

describe('知识库对话的前缀', () => {
  it('列、建、看、改名、归档都打在 knowledge 前缀的 /chat-sessions 上', async () => {
    await api.listSessions()
    expect(lastCall(requestData)[0]).toBe('/chat-sessions')
    expect(lastCall(requestData)[1].baseUrl).toBe(PREFIX)

    requestData.mockResolvedValue({ id: 's1' })
    await api.createSession('锅炉')
    expect(lastCall(requestData)[1].method).toBe('POST')

    await api.readSession('s1')
    expect(lastCall(requestData)[0]).toBe('/chat-sessions/s1')

    await api.renameSession('s1', '新名')
    expect(lastCall(requestData)[1].method).toBe('PATCH')
    expect(lastCall(requestData)[1].body).toEqual({ title: '新名' })

    await api.archiveSession('s1')
    expect(lastCall(requestData)[1].body).toEqual({ is_archived: true })
  })

  it('列表缺省只要没归档的', async () => {
    await api.listSessions()
    const query = lastCall(requestData)[1].query as Record<string, unknown>
    expect(query.is_archived).toBe('false')
  })

  it('删对话走 request 而不是 requestData', async () => {
    // ⚠ 204 没有响应体，requestData 见 null 就抛——一次成功的删除会被读成失败
    await api.deleteSession('s1')

    expect(requestData).not.toHaveBeenCalled()
    expect(lastCall(request)[0]).toBe('/chat-sessions/s1')
    expect(lastCall(request)[1].method).toBe('DELETE')
  })

  it('推进一个回合开的是 knowledge 前缀下的事件流', () => {
    api.advanceTurn('s1', { user_text: '嗨', client_tools: ['user.ask'] })

    const [path, options] = lastCall(openStream)
    expect(path).toBe('/chat-sessions/s1:advance')
    expect(options.baseUrl).toBe(PREFIX)
  })
})
