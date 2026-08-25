/**
 * @fileoverview 契约：助手那一组接口打的是 **ai-assistant**，不是 auth。
 *
 * ⚠ 每个请求都要给 `baseUrl`。漏了会静默打到 auth-server 上，现象是「助手
 * 永远说不出话」而不是一个报错——所以这一条要逐个端点钉住。
 *
 * ⚠ 能力探测**任何失败都收成 null**：某些现场根本不部署这套服务，那时边缘
 * 直接 502，而入口该干净地不出现，不是弹一条红色告警。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as assistant from '@/api/assistant'
import * as client from '@/api/client'
import { ASSISTANT_BASE_URL } from '@/config/app'

let requestMock: ReturnType<typeof vi.fn>
let streamMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  requestMock = vi.fn().mockResolvedValue({ id: 's1' })
  streamMock = vi.fn()
  vi.spyOn(client, 'request').mockImplementation(requestMock)
  vi.spyOn(client, 'requestData').mockImplementation(requestMock)
  vi.spyOn(client, 'openStream').mockImplementation(streamMock)
})

afterEach(() => {
  vi.restoreAllMocks()
})

function call(): [string, Record<string, unknown>] {
  const args = requestMock.mock.calls.at(-1)
  return [args?.[0] as string, (args?.[1] ?? {}) as Record<string, unknown>]
}

describe('每一个端点都打在 ai-assistant 上', () => {
  it('列会话带上工作面筛选', async () => {
    await assistant.listSessions('dashboard-editor')
    const [path, options] = call()
    expect(path).toBe('/sessions')
    expect(options.baseUrl).toBe(ASSISTANT_BASE_URL)
    expect(options.query).toEqual({ surface_kind: 'dashboard-editor' })
  })

  it('建会话是 POST，且带幂等键', async () => {
    await assistant.createSession('dashboard-editor', 'db1', 'key-1')
    const [path, options] = call()
    expect(path).toBe('/sessions')
    expect(options.method).toBe('POST')
    expect(options.body).toEqual({
      surface_kind: 'dashboard-editor',
      surface_ref: 'db1',
    })
    expect(options.headers).toEqual({ 'Idempotency-Key': 'key-1' })
  })

  it('不给幂等键时自己生成一个', async () => {
    await assistant.createSession('twin-editor', null)
    const [, options] = call()
    const headers = options.headers as Record<string, string>
    expect(headers['Idempotency-Key']).toMatch(/\S/)
  })

  it('读会话打在子资源上', async () => {
    await assistant.readSession('abc')
    const [path, options] = call()
    expect(path).toBe('/sessions/abc')
    expect(options.baseUrl).toBe(ASSISTANT_BASE_URL)
  })

  it('归档是 PATCH，不是删', async () => {
    await assistant.archiveSession('abc')
    const [path, options] = call()
    expect(path).toBe('/sessions/abc')
    expect(options.method).toBe('PATCH')
    // 归档只是不再列出，历史一条都不删
    expect(options.body).toEqual({ is_archived: true })
  })

  it('解析点表走 base64 放在 JSON 里，不是 multipart', async () => {
    await assistant.parseAttachment('点表.xlsx', 'AAAA')
    const [path, options] = call()
    expect(path).toBe('/attachments:parse')
    expect(options.method).toBe('POST')
    expect(options.body).toEqual({
      filename: '点表.xlsx',
      content_base64: 'AAAA',
    })
  })

  it('推进回合走事件流，且把中止信号一路带下去', () => {
    const controller = new AbortController()
    assistant.advanceTurn(
      'abc',
      { surface_kind: 'dashboard-editor', user_text: '在吗' },
      controller.signal,
    )
    const [path, options] = streamMock.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ]
    expect(path).toBe('/sessions/abc:advance')
    expect(options.baseUrl).toBe(ASSISTANT_BASE_URL)
    // 不 abort 的话组件没了而读取还在，一路写进已经销毁的状态
    expect(options.signal).toBe(controller.signal)
  })
})

describe('能力探测', () => {
  it('取到什么就回什么', async () => {
    requestMock.mockResolvedValue({ is_model_enabled: true, skills: [] })
    const got = await assistant.probeCapability()
    expect(got).toEqual({ is_model_enabled: true, skills: [] })
  })

  it('服务没部署（502）时收成 null 而不是抛', async () => {
    requestMock.mockRejectedValue(new Error('Bad Gateway'))
    await expect(assistant.probeCapability()).resolves.toBeNull()
  })

  it('没权限（403）时同样收成 null', async () => {
    // 「这套部署没有助手」与「这个账号用不了助手」在界面上是同一件事：
    // 都该是安静地没有入口
    requestMock.mockRejectedValue(new Error('Forbidden'))
    await expect(assistant.probeCapability()).resolves.toBeNull()
  })
})
