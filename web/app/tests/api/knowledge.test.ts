/**
 * @fileoverview 锁住知识库面每个端点的路径与前缀，以及直传那三步的次序。
 *
 * ⚠ 前缀漏了的话，客户端会拿缺省的 auth 前缀再拼一次，打出
 * `/api/v1/auth/api/v1/knowledge/...`——这个地址在边缘**有人接**（auth-server），
 * 回来的是一个 403 的 HTML 页，前端只说得出一句「服务端响应格式异常」，
 * 看着像后端坏了。整页的挂载测试挡不住它：那一层把 `@/api/knowledge` 整个
 * 替身掉了，URL 是怎么拼的根本没人跑过。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as client from '@/api/client'
import * as knowledge from '@/api/knowledge'
import * as upload from '@/api/upload'

const KNOWLEDGE_PREFIX = '/api/v1/knowledge'

let requestData: ReturnType<typeof vi.fn>
let request: ReturnType<typeof vi.fn>
let postUploadForm: ReturnType<typeof vi.fn>

const BASE_WIRE = {
  id: 'b1',
  name: '运维手册',
  description: '',
  retrieval_strategy: 'hybrid',
  embedding_model: 'text-embedding-3-small',
  dimensions: 1536,
  document_count: 3,
  created_at: '2026-09-01T00:00:00.000Z',
}

const DOCUMENT_WIRE = {
  id: 'd1',
  title: '一号机组.docx',
  status: 'ready',
  failure_reason: '',
  chunk_count: 12,
  byte_size: 2048,
  created_at: '2026-09-01T00:00:00.000Z',
  ready_at: '2026-09-01T00:01:00.000Z',
}

const TICKET_WIRE = {
  document_id: 'd1',
  url: '/oss/',
  fields: { key: 'staging/kb/d1', policy: 'p', signature: 's' },
  expires_seconds: 900,
}

beforeEach(() => {
  requestData = vi.fn().mockResolvedValue({ items: [] })
  request = vi.fn().mockResolvedValue(null)
  postUploadForm = vi.fn().mockResolvedValue(undefined)
  vi.spyOn(client, 'requestData').mockImplementation(requestData)
  vi.spyOn(client, 'request').mockImplementation(request)
  vi.spyOn(upload, 'postUploadForm').mockImplementation(postUploadForm)
})

afterEach(() => {
  vi.restoreAllMocks()
})

function callAt(
  spy: ReturnType<typeof vi.fn>,
  index: number,
): [string, Record<string, unknown>] {
  const args = spy.mock.calls[index]
  return [args?.[0] as string, (args?.[1] ?? {}) as Record<string, unknown>]
}

function lastCall(
  spy: ReturnType<typeof vi.fn>,
): [string, Record<string, unknown>] {
  return callAt(spy, spy.mock.calls.length - 1)
}

describe('知识库面的前缀', () => {
  it('能力、列库、建库都打在 knowledge 前缀上', async () => {
    requestData.mockResolvedValue({
      is_embedding_enabled: true,
      is_model_enabled: true,
      strategies: ['naive'],
      ready_strategies: ['naive'],
      accepted_suffixes: ['.md'],
      index: { vector: 'pgvector', keyword: 'trgm', reason: '' },
    })
    await knowledge.readCapability()
    expect(lastCall(requestData)[0]).toBe('/capabilities')
    expect(lastCall(requestData)[1].baseUrl).toBe(KNOWLEDGE_PREFIX)

    requestData.mockResolvedValue({ items: [BASE_WIRE] })
    await knowledge.listBases()
    expect(lastCall(requestData)[0]).toBe('/knowledge-bases')
    expect(lastCall(requestData)[1].baseUrl).toBe(KNOWLEDGE_PREFIX)

    requestData.mockResolvedValue(BASE_WIRE)
    await knowledge.createBase('运维手册', '', 'hybrid')
    expect(lastCall(requestData)[1].method).toBe('POST')
    expect(lastCall(requestData)[1].baseUrl).toBe(KNOWLEDGE_PREFIX)
  })

  it('来源、同步、文档、重解析、检索也都在 knowledge 前缀上', async () => {
    requestData.mockResolvedValue([])
    await knowledge.listSources('b1')
    expect(lastCall(requestData)[0]).toBe('/knowledge-bases/b1/sources')
    expect(lastCall(requestData)[1].baseUrl).toBe(KNOWLEDGE_PREFIX)

    requestData.mockResolvedValue({ registered: 2, skipped: 1 })
    await knowledge.syncSource('s1')
    expect(lastCall(requestData)[0]).toBe('/sources/s1:sync')

    requestData.mockResolvedValue({ items: [DOCUMENT_WIRE] })
    await knowledge.listDocuments('b1')
    expect(lastCall(requestData)[0]).toBe('/documents')
    expect(lastCall(requestData)[1].baseUrl).toBe(KNOWLEDGE_PREFIX)

    requestData.mockResolvedValue(DOCUMENT_WIRE)
    await knowledge.reparseDocument('d1')
    expect(lastCall(requestData)[0]).toBe('/documents/d1:reparse')

    requestData.mockResolvedValue({ hits: [], strategy: 'hybrid', note: '' })
    await knowledge.searchBase('b1', '锅炉')
    expect(lastCall(requestData)[0]).toBe('/knowledge-bases/b1:search')
    expect(lastCall(requestData)[1].baseUrl).toBe(KNOWLEDGE_PREFIX)
  })
})

describe('两个 204 的端点', () => {
  it('删库走 request 而不是 requestData', async () => {
    // ⚠ 204 没有响应体，`requestData` 见 null 就抛「服务端未返回数据」——
    // 一次**成功**的删除会被读成失败
    await knowledge.deleteBase('b1')

    expect(requestData).not.toHaveBeenCalled()
    expect(lastCall(request)[0]).toBe('/knowledge-bases/b1')
    expect(lastCall(request)[1].method).toBe('DELETE')
    expect(lastCall(request)[1].baseUrl).toBe(KNOWLEDGE_PREFIX)
  })

  it('删文档同理', async () => {
    await knowledge.deleteDocument('d1')

    expect(requestData).not.toHaveBeenCalled()
    expect(lastCall(request)[0]).toBe('/documents/d1')
    expect(lastCall(request)[1].method).toBe('DELETE')
  })
})

describe('直传三步', () => {
  it('先签凭证、再直传对象存储、最后才登记', async () => {
    requestData
      .mockResolvedValueOnce(TICKET_WIRE)
      .mockResolvedValueOnce(DOCUMENT_WIRE)
    const file = new File(['x'], '一号机组.docx', {
      type:
        'application/vnd.openxmlformats-officedocument' +
        '.wordprocessingml.document',
    })

    const made = await knowledge.uploadDocument('b1', file)

    expect(callAt(requestData, 0)[0]).toBe('/documents:upload-ticket')
    expect(postUploadForm).toHaveBeenCalledWith(
      '/oss/',
      TICKET_WIRE.fields,
      file,
      {},
    )
    expect(callAt(requestData, 1)[0]).toBe('/documents')
    expect(made.id).toBe('d1')
  })

  it('登记那一步带上凭证给的 document_id', async () => {
    // ⚠ 换成前端自己生成的 id 就会登记到一份不存在的原件上，而两步各自都成功
    requestData
      .mockResolvedValueOnce(TICKET_WIRE)
      .mockResolvedValueOnce(DOCUMENT_WIRE)

    await knowledge.uploadDocument(
      'b1',
      new File(['x'], 'a.md', { type: 'text/markdown' }),
    )

    const body = callAt(requestData, 1)[1].body as Record<string, unknown>
    expect(body.document_id).toBe('d1')
  })

  it('直传失败时不去登记', async () => {
    // ⚠ 登记了的话，界面上会多出一份永远读不出内容的鬼影文档
    requestData.mockResolvedValueOnce(TICKET_WIRE)
    postUploadForm.mockRejectedValueOnce(new Error('网络断了'))

    await expect(
      knowledge.uploadDocument(
        'b1',
        new File(['x'], 'a.md', { type: 'text/markdown' }),
      ),
    ).rejects.toThrow('网络断了')
    expect(requestData).toHaveBeenCalledTimes(1)
  })
})
