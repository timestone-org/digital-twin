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
let requestBytes: ReturnType<typeof vi.fn>
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
  has_raw: true,
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
  requestData = vi
    .fn()
    .mockResolvedValue({ items: [], page: 1, size: 100, total: 0 })
  request = vi.fn().mockResolvedValue(null)
  requestBytes = vi.fn().mockResolvedValue(new Blob(['x']))
  postUploadForm = vi.fn().mockResolvedValue(undefined)
  vi.spyOn(client, 'requestData').mockImplementation(requestData)
  vi.spyOn(client, 'request').mockImplementation(request)
  vi.spyOn(client, 'requestBytes').mockImplementation(requestBytes)
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

    requestData.mockResolvedValue({
      items: [BASE_WIRE],
      page: 1,
      size: 100,
      total: 1,
    })
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

describe('检索取消', () => {
  it('单库读取使用既有知识库GET，返回真实文档数并透传取消信号', async () => {
    const signal = new AbortController().signal
    requestData.mockResolvedValue(BASE_WIRE)

    const base = await knowledge.readBase('b1', signal)

    expect(base.documentCount).toBe(3)
    expect(lastCall(requestData)).toEqual([
      '/knowledge-bases/b1',
      { baseUrl: KNOWLEDGE_PREFIX, signal },
    ])
  })

  it('检索透传取消信号，保留原请求路径与策略', async () => {
    const controller = new AbortController()
    requestData.mockResolvedValue({ hits: [], strategy: 'hybrid', note: '' })
    await knowledge.searchBase('b1', '锅炉', 'hybrid', controller.signal)
    expect(lastCall(requestData)).toEqual([
      '/knowledge-bases/b1:search',
      expect.objectContaining({
        baseUrl: KNOWLEDGE_PREFIX,
        method: 'POST',
        body: { query: '锅炉', limit: 8, strategy: 'hybrid' },
        signal: controller.signal,
      }),
    ])
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

describe('取图', () => {
  it('走取图端点并带上知识库前缀', async () => {
    // ⚠ 走 `requestBytes` 而不是把地址写进 `<img src>`：浏览器给图片请求带不上
    // Authorization，而知识库的图要认人（素材那条 `/oss/` 才是匿名可读的）
    await knowledge.readFigureBytes('d1', 'f1')

    expect(lastCall(requestBytes)[0]).toBe('/documents/d1/figures/f1')
    expect(lastCall(requestBytes)[1].baseUrl).toBe(KNOWLEDGE_PREFIX)
  })

  it('给了中止信号就带上', async () => {
    const controller = new AbortController()

    await knowledge.readFigureBytes('d1', 'f1', controller.signal)

    expect(lastCall(requestBytes)[1].signal).toBe(controller.signal)
  })
})

describe('取原件', () => {
  it('走取原件端点并带上知识库前缀', async () => {
    // ⚠ 同样走 `requestBytes`：这条地址写进 `<iframe src>` 的表现是一个空白框，
    // 浏览器给子资源请求带不上 Authorization，而原件不匿名可读
    await knowledge.readDocumentRaw('d1')

    expect(lastCall(requestBytes)[0]).toBe('/documents/d1/raw')
    expect(lastCall(requestBytes)[1].baseUrl).toBe(KNOWLEDGE_PREFIX)
  })

  it('给了中止信号就带上', async () => {
    const controller = new AbortController()

    await knowledge.readDocumentRaw('d1', controller.signal)

    expect(lastCall(requestBytes)[1].signal).toBe(controller.signal)
  })

  it('DOCX 页面预览走派生物端点并带上中止信号', async () => {
    const controller = new AbortController()

    await knowledge.readDocumentPreview('d1', controller.signal)

    expect(lastCall(requestBytes)[0]).toBe('/documents/d1/preview')
    expect(lastCall(requestBytes)[1].baseUrl).toBe(KNOWLEDGE_PREFIX)
    expect(lastCall(requestBytes)[1].signal).toBe(controller.signal)
  })
})

describe('来源创建与竞态信号', () => {
  it('创建仅提交已声明的平台配置字段到所属库', async () => {
    requestData.mockResolvedValue({
      id: 's1',
      base_id: 'b1',
      kind: 'platform',
      name: '台账',
      config: { path: '/api/v1/platform/tables' },
    })
    const config = {
      path: '/api/v1/platform/tables',
      id_field: 'row_id',
      title_field: '',
      page_param: 'page',
      size_param: 'size',
    }
    const made = await knowledge.createSource('b1', {
      kind: 'platform',
      name: '台账',
      config,
    })
    expect(lastCall(requestData)).toEqual([
      '/knowledge-bases/b1/sources',
      {
        baseUrl: KNOWLEDGE_PREFIX,
        method: 'POST',
        body: { kind: 'platform', name: '台账', config },
      },
    ])
    expect(made.config.path).toBe(config.path)
  })

  it('来源列表透传中止信号', async () => {
    requestData.mockResolvedValue([])
    const signal = new AbortController().signal
    await knowledge.listSources('b1', signal)
    expect(lastCall(requestData)[1].signal).toBe(signal)
  })
})

describe('首次知识库分页', () => {
  it('首次101库继续读第二页，让最早的库可以浏览选择', async () => {
    requestData
      .mockResolvedValueOnce({
        items: Array.from({ length: 100 }, (_, id) => ({
          ...BASE_WIRE,
          id: `b${id}`,
        })),
        page: 1,
        size: 100,
        total: 101,
      })
      .mockResolvedValueOnce({
        items: [{ ...BASE_WIRE, id: 'oldest' }],
        page: 2,
        size: 100,
        total: 101,
      })
    const rows = await knowledge.listBases()
    expect(rows).toHaveLength(101)
    expect(rows.at(-1)?.id).toBe('oldest')
    expect(callAt(requestData, 1)[1].query).toEqual({ page: 2, size: 100 })
  })

  it('分页边界100库不发多余第二页请求', async () => {
    requestData.mockResolvedValue({
      items: Array.from({ length: 100 }, (_, id) => ({
        ...BASE_WIRE,
        id: `b${id}`,
      })),
      page: 1,
      size: 100,
      total: 100,
    })
    expect(await knowledge.listBases()).toHaveLength(100)
    expect(requestData).toHaveBeenCalledOnce()
  })

  it('第一页面返回前取消不继续加载后页', async () => {
    const controller = new AbortController()
    requestData.mockImplementation(() => {
      controller.abort()
      return Promise.resolve({
        items: [BASE_WIRE],
        page: 1,
        size: 100,
        total: 101,
      })
    })
    await expect(knowledge.listBases(controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(requestData).toHaveBeenCalledOnce()
  })

  it('分页间数据移动去重，不把同一个库渲染两次', async () => {
    requestData
      .mockResolvedValueOnce({
        items: [BASE_WIRE],
        page: 1,
        size: 100,
        total: 201,
      })
      .mockResolvedValueOnce({
        items: [BASE_WIRE, { ...BASE_WIRE, id: 'b2' }],
        page: 2,
        size: 100,
        total: 201,
      })
      .mockResolvedValueOnce({
        items: [BASE_WIRE],
        page: 3,
        size: 100,
        total: 201,
      })
    expect((await knowledge.listBases()).map((row) => row.id)).toEqual([
      'b1',
      'b2',
    ])
  })

  it('第二页失败不返回看似完整的首100库', async () => {
    requestData
      .mockResolvedValueOnce({
        items: [BASE_WIRE],
        page: 1,
        size: 100,
        total: 101,
      })
      .mockRejectedValueOnce(new Error('第二页读取失败'))
    await expect(knowledge.listBases()).rejects.toThrow('第二页读取失败')
  })
})

it.each([-1, NaN, Infinity, 1.5])(
  '分页总数%s异常时拒绝伪完整列表',
  async (total) => {
    requestData.mockResolvedValue({
      items: [BASE_WIRE],
      page: 1,
      size: 100,
      total,
    })
    await expect(knowledge.listBases()).rejects.toThrow('知识库分页总数异常')
  },
)

it('首次空库立即返回，预取消不发请求', async () => {
  requestData.mockResolvedValue({ items: [], page: 1, size: 100, total: 0 })
  expect(await knowledge.listBases()).toEqual([])
  requestData.mockClear()
  const controller = new AbortController()
  controller.abort()
  await expect(knowledge.listBases(controller.signal)).rejects.toMatchObject({
    name: 'AbortError',
  })
  expect(requestData).not.toHaveBeenCalled()
})

it('以首次有限total确定终点，不被后页增长持续追赶', async () => {
  requestData
    .mockResolvedValueOnce({
      items: [BASE_WIRE],
      page: 1,
      size: 100,
      total: 101,
    })
    .mockResolvedValueOnce({
      items: [{ ...BASE_WIRE, id: 'b2' }],
      page: 2,
      size: 100,
      total: 1000000,
    })
  expect((await knowledge.listBases()).map((row) => row.id)).toEqual([
    'b1',
    'b2',
  ])
  expect(requestData).toHaveBeenCalledTimes(2)
})

it.each([null, undefined])(
  '缺失或null的必需分页total拒绝伪完整列表（%s）',
  async (total) => {
    requestData.mockResolvedValue({
      items: Array.from({ length: 100 }, () => BASE_WIRE),
      page: 1,
      size: 100,
      total,
    })
    await expect(knowledge.listBases()).rejects.toThrow('知识库分页总数异常')
  },
)

it('非零总数的中途空页拒绝伪完整列表，用户可重试', async () => {
  requestData
    .mockResolvedValueOnce({
      items: [BASE_WIRE],
      page: 1,
      size: 100,
      total: 101,
    })
    .mockResolvedValueOnce({ items: [], page: 2, size: 100, total: 101 })
  await expect(knowledge.listBases()).rejects.toThrow(
    '知识库分页为空，请刷新重试',
  )
  expect(requestData).toHaveBeenCalledTimes(2)
})
