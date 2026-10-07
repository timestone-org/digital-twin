/**
 * @fileoverview 知识库页的编排：防竞态、切库清场、报错说人话、上传逐个来。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'
import { flushPromises } from '@vue/test-utils'

import * as api from '@/api/knowledge'
import * as client from '@/api/client'
import { TransportError } from '@/api/client'
import type { RequestOptions } from '@/api/client'
import { useKnowledgePage } from '@/pages/Knowledge/scripts/useKnowledgePage'
import type { KnowledgeBase, KnowledgeDocument } from '@/api/knowledge'

function baseOf(id: string, name: string): KnowledgeBase {
  return {
    id,
    name,
    description: '',
    strategy: 'hybrid',
    embeddingModel: null,
    dimensions: null,
    documentCount: 0,
    createdAt: '2026-09-01T00:00:00.000Z',
  }
}

function documentOf(id: string): KnowledgeDocument {
  return {
    id,
    title: `${id}.md`,
    status: 'ready',
    failureReason: '',
    chunkCount: 1,
    sizeBytes: 8,
    hasRaw: true,
    createdAt: '2026-09-01T00:00:00.000Z',
    readyAt: '2026-09-01T00:00:01.000Z',
  }
}

function baseWire(id: string, count: number) {
  return {
    id,
    name: id,
    description: '',
    retrieval_strategy: 'hybrid',
    embedding_model: null,
    dimensions: null,
    document_count: count,
    created_at: '2026-09-01T00:00:00.000Z',
  }
}

/** 一个能按名字放行的迟到者。 */
function deferred<T>(): { promise: Promise<T>; settle: (value: T) => void } {
  let settle: (value: T) => void = () => undefined
  const promise = new Promise<T>((resolve) => {
    settle = resolve
  })
  return { promise, settle }
}

beforeEach(() => {
  vi.spyOn(api, 'listDocuments').mockResolvedValue([])
  vi.spyOn(api, 'listBases').mockResolvedValue([])
  vi.spyOn(api, 'readBase').mockImplementation((id) =>
    Promise.resolve(baseOf(id, id)),
  )
  vi.spyOn(api, 'readCapability').mockResolvedValue({
    isEmbeddingEnabled: true,
    isModelEnabled: true,
    isAsrEnabled: false,
    strategies: ['naive', 'hybrid', 'agentic'],
    readyStrategies: ['naive', 'hybrid'],
    sourceKinds: ['upload', 'platform'],
    acceptedSuffixes: ['.md', '.docx'],
    index: { vector: 'pgvector', keyword: 'trgm', reason: '' },
    rerank: {
      isEnabled: false,
      model: '',
      reason: '还没给「知识库重排」分配模型',
    },
  })
})

describe('已显示库落出列表第一页', () => {
  beforeEach(() => {
    vi.mocked(api.readBase).mockRestore()
  })
  const firstPage = Array.from({ length: 100 }, (_, i) =>
    baseOf(`b${i}`, `库${i}`),
  )

  it('上传后补读第101库真实计数，不重读第一页内的100库', async () => {
    const read = vi
      .spyOn(client, 'requestData')
      .mockResolvedValue(baseWire('old', 7))
    vi.mocked(api.listBases).mockResolvedValue(firstPage)
    vi.spyOn(api, 'uploadDocument').mockResolvedValue(documentOf('d1'))
    const page = useKnowledgePage()
    page.bases.value = [...firstPage, baseOf('old', '原最旧库')]
    page.selectedId.value = 'old'

    expect(await page.addFiles([new File(['a'], 'a.md')])).toBe(1)

    expect(page.selected.value?.documentCount).toBe(7)
    expect(page.bases.value).toHaveLength(101)
    expect(api.listBases).not.toHaveBeenCalled()
    expect(read).toHaveBeenCalledOnce()
    expect(read.mock.calls[0]?.[0]).toBe('/knowledge-bases/old')
  })

  it('轮询只刷新当前库，重载保留选择但不重新引入其它旧库', async () => {
    const read = vi
      .spyOn(client, 'requestData')
      .mockResolvedValueOnce(baseWire('old', 7))
      .mockResolvedValueOnce(baseWire('old', 9))
    vi.mocked(api.listBases).mockResolvedValue(firstPage)
    const page = useKnowledgePage()
    page.bases.value = [
      ...firstPage,
      baseOf('old', '甲'),
      baseOf('older', '乙'),
    ]
    page.selectedId.value = 'old'

    await page.refreshDocuments()
    expect(page.bases.value.slice(-2).map((one) => one.documentCount)).toEqual([
      7, 0,
    ])
    await page.reload()

    expect(page.selectedId.value).toBe('old')
    expect(page.selected.value?.documentCount).toBe(9)
    expect(page.bases.value).toHaveLength(101)
    expect(read.mock.calls.map((call) => call[0])).toEqual([
      '/knowledge-bases/old',
      '/knowledge-bases/old',
    ])
  })

  it('缺失库补读失败保持已有统计并明确报告，用户重试能恢复', async () => {
    vi.spyOn(client, 'requestData')
      .mockRejectedValueOnce(new Error('单库读取被拒绝'))
      .mockResolvedValueOnce(baseWire('old', 4))
    vi.mocked(api.listBases).mockResolvedValue(firstPage)
    const page = useKnowledgePage()
    page.bases.value = [{ ...baseOf('old', '甲'), documentCount: 2 }]
    page.selectedId.value = 'old'

    await page.refreshDocuments()
    expect(page.selected.value?.documentCount).toBe(2)
    expect(page.error.value).toContain('文档数未刷新：单库读取被拒绝')
    await page.refreshDocuments()
    expect(page.selected.value?.documentCount).toBe(4)
    expect(page.error.value).toBe('')
  })

  it('重载途中切到另一页外库，不丢选择并明确提示该库统计待重试', async () => {
    const slow = deferred<unknown>()
    const read = vi
      .spyOn(client, 'requestData')
      .mockReturnValueOnce(slow.promise)
      .mockResolvedValueOnce(baseWire('older', 8))
    vi.mocked(api.listBases).mockResolvedValue(firstPage)
    const page = useKnowledgePage()
    page.bases.value = [baseOf('old', '甲'), baseOf('older', '乙')]
    page.selectedId.value = 'old'
    const pending = page.reload()
    await flushPromises()
    await page.select('older')
    slow.settle(baseWire('old', 7))
    await pending

    expect(page.selectedId.value).toBe('older')
    expect(page.selected.value?.name).toBe('乙')
    expect(page.error.value).toContain('选中库文档数未刷新')
    await page.reload()
    expect(page.selected.value?.documentCount).toBe(8)
    expect(page.error.value).toBe('')
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('旧单库补读迟到不能覆盖新统计，后次读取中止前次信号', async () => {
    const slow = deferred<unknown>()
    const read = vi
      .spyOn(client, 'requestData')
      .mockReturnValueOnce(slow.promise)
      .mockResolvedValueOnce(baseWire('old', 3))
    vi.mocked(api.listBases).mockResolvedValue(firstPage)
    const page = useKnowledgePage()
    page.bases.value = [baseOf('old', '甲')]
    page.selectedId.value = 'old'
    const pending = page.refreshDocuments()
    await flushPromises()
    await page.refreshDocuments()
    slow.settle(baseWire('old', 1))
    await pending

    expect(page.selected.value?.documentCount).toBe(3)
    expect(read.mock.calls[0]?.[1]?.signal?.aborted).toBe(true)
  })

  it('离页后不发后续补读或把迟到计数写回', async () => {
    const slow = deferred<unknown>()
    const read = vi.spyOn(client, 'requestData').mockReturnValue(slow.promise)
    vi.mocked(api.listBases).mockResolvedValue(firstPage)
    const scope = effectScope()
    const page = scope.run(useKnowledgePage)
    if (page === undefined) throw new Error('页面状态未创建')
    page.bases.value = [baseOf('old', '甲'), baseOf('older', '乙')]
    page.selectedId.value = 'old'
    const pending = page.refreshDocuments()
    await flushPromises()
    scope.stop()
    slow.settle(baseWire('old', 7))
    await pending

    expect(read).toHaveBeenCalledOnce()
    expect(read.mock.calls[0]?.[1]?.signal?.aborted).toBe(true)
    expect(page.selected.value?.documentCount).toBe(0)
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('切库', () => {
  it('慢回来的那一次不许覆盖后选的库', async () => {
    // ⚠ 不丢的话，右边显示的是上一个库的文档，而两边看着都正常
    const slow = deferred<KnowledgeDocument[]>()
    vi.mocked(api.listDocuments)
      .mockReturnValueOnce(slow.promise)
      .mockResolvedValueOnce([documentOf('d2')])
    const page = useKnowledgePage()

    const first = page.select('b1')
    await page.select('b2')
    slow.settle([documentOf('d1')])
    await first

    expect(page.documents.value.map((one) => one.id)).toEqual(['d2'])
  })

  it('切库顺手清掉上一次的检索结果', async () => {
    // ⚠ 留着的话，用户会以为那是新库里的召回
    vi.spyOn(api, 'searchBase').mockResolvedValue({
      hits: [],
      strategy: 'hybrid',
      note: '本次只走了关键词那一路',
    })
    const page = useKnowledgePage()
    page.selectedId.value = 'b1'
    page.query.value = '锅炉'
    await page.search()
    expect(page.result.value).not.toBeNull()

    await page.select('b2')

    expect(page.result.value).toBeNull()
    expect(page.searched.value).toBe('')
  })

  it('没选库时文档清空且不发请求', async () => {
    const page = useKnowledgePage()

    await page.refreshDocuments()

    expect(api.listDocuments).not.toHaveBeenCalled()
    expect(page.documents.value).toEqual([])
  })
})

describe('报错', () => {
  it('把后端那句原话显示出来', async () => {
    // ⚠ 换成一句笼统的「操作失败」等于把唯一有用的信息扔掉
    vi.mocked(api.listDocuments).mockRejectedValue(
      new TransportError(409, '这份内容已经在这个库里了'),
    )
    const page = useKnowledgePage()

    await page.select('b1')

    expect(page.error.value).toBe('这份内容已经在这个库里了')
  })

  it('连一句话都没有时才回落到通用提示', async () => {
    vi.mocked(api.listDocuments).mockRejectedValue(new Error(''))
    const page = useKnowledgePage()

    await page.select('b1')

    expect(page.error.value).toBe('操作失败，请重试')
  })

  it('下一次动作把上一次的错清掉', async () => {
    vi.mocked(api.listDocuments)
      .mockRejectedValueOnce(new Error('断了'))
      .mockResolvedValueOnce([])
    const page = useKnowledgePage()
    await page.select('b1')
    expect(page.error.value).toBe('断了')

    await page.select('b2')

    expect(page.error.value).toBe('')
  })
})

describe('建库删库', () => {
  it('建完立刻切过去，并排在最前', async () => {
    vi.spyOn(api, 'createBase').mockResolvedValue(baseOf('b9', '新库'))
    const page = useKnowledgePage()
    page.bases.value = [baseOf('b1', '旧库')]

    const made = await page.create('新库', '')

    expect(made).toBe(true)
    expect(api.createBase).toHaveBeenCalledWith('新库', '', 'hybrid')
    expect(page.bases.value.map((one) => one.id)).toEqual(['b9', 'b1'])
    expect(page.selectedId.value).toBe('b9')
  })

  it('描述原样带上，策略固定混合', async () => {
    vi.spyOn(api, 'createBase').mockResolvedValue(baseOf('b9', '新库'))
    const page = useKnowledgePage()

    await page.create('新库', '锅炉相关的规程')

    expect(api.createBase).toHaveBeenCalledWith(
      '新库',
      '锅炉相关的规程',
      'hybrid',
    )
  })

  it('建库炸了回 false，清单不动，那句话留在 error 上', async () => {
    vi.spyOn(api, 'createBase').mockRejectedValue(new Error('同名的库已经有了'))
    const page = useKnowledgePage()
    page.bases.value = [baseOf('b1', '旧库')]

    const made = await page.create('新库', '')

    expect(made).toBe(false)
    expect(page.bases.value.map((one) => one.id)).toEqual(['b1'])
    expect(page.error.value).toBe('同名的库已经有了')
  })

  it('删掉当前库时把右边一起清空', async () => {
    // ⚠ 不清的话，右边留着一份已经不存在的库的文档，点重解析会 404
    vi.spyOn(api, 'deleteBase').mockResolvedValue(undefined)
    const page = useKnowledgePage()
    page.bases.value = [baseOf('b1', '甲'), baseOf('b2', '乙')]
    page.selectedId.value = 'b1'
    page.documents.value = [documentOf('d1')]

    const dropped = await page.drop('b1')

    expect(dropped).toBe(true)
    expect(page.bases.value.map((one) => one.id)).toEqual(['b2'])
    expect(page.selectedId.value).toBe('')
    expect(page.documents.value).toEqual([])
  })

  it('删的不是当前库时不动当前选中', async () => {
    vi.spyOn(api, 'deleteBase').mockResolvedValue(undefined)
    const page = useKnowledgePage()
    page.bases.value = [baseOf('b1', '甲'), baseOf('b2', '乙')]
    page.selectedId.value = 'b1'

    await page.drop('b2')

    expect(page.selectedId.value).toBe('b1')
  })
})

describe('上传', () => {
  it('部分上传失败仍刷新已成功文档的真实计数并保留失败原因', async () => {
    vi.spyOn(api, 'uploadDocument')
      .mockResolvedValueOnce(documentOf('d1'))
      .mockRejectedValueOnce(new Error('第二份上传失败'))
    vi.mocked(api.readBase).mockResolvedValue({
      ...baseOf('b1', '甲'),
      documentCount: 1,
    })
    vi.mocked(api.listDocuments).mockResolvedValue([documentOf('d1')])
    const page = useKnowledgePage()
    page.bases.value = [baseOf('b1', '甲')]
    page.selectedId.value = 'b1'

    const uploaded = await page.addFiles([
      new File(['a'], 'a.md'),
      new File(['b'], 'b.md'),
    ])

    expect(uploaded).toBe(1)
    expect(page.selected.value?.documentCount).toBe(1)
    expect(page.documents.value.map((one) => one.id)).toEqual(['d1'])
    expect(page.error.value).toBe('第二份上传失败')
  })

  it('上传期间切库，刷新原库计数但不切回或覆盖当前库文档', async () => {
    const pending = deferred<KnowledgeDocument>()
    vi.spyOn(api, 'uploadDocument').mockReturnValue(pending.promise)
    vi.mocked(api.readBase).mockImplementation((id) =>
      Promise.resolve({
        ...baseOf(id, id),
        documentCount: id === 'b1' ? 1 : 2,
      }),
    )
    vi.mocked(api.listDocuments).mockImplementation((baseId) =>
      Promise.resolve(
        baseId === 'b2' ? [documentOf('d2')] : [documentOf('d1')],
      ),
    )
    const page = useKnowledgePage()
    page.bases.value = [baseOf('b1', '甲'), baseOf('b2', '乙')]
    page.selectedId.value = 'b1'
    const uploading = page.addFiles([new File(['a'], 'a.md')])
    await page.select('b2')
    pending.settle(documentOf('d1'))
    await uploading

    expect(page.selectedId.value).toBe('b2')
    expect(page.documents.value.map((one) => one.id)).toEqual(['d2'])
    expect(page.bases.value.find((one) => one.id === 'b1')?.documentCount).toBe(
      1,
    )
  })

  it('逐个传，且传完统一重取一次文档', async () => {
    // ⚠ 并发几份大文件时，进度条只能显示其中一个，用户看到的是「卡住了」
    const order: string[] = []
    vi.spyOn(api, 'uploadDocument').mockImplementation(async (_id, file) => {
      order.push(file.name)
      await Promise.resolve()
      return documentOf(file.name)
    })
    const page = useKnowledgePage()
    page.selectedId.value = 'b1'

    const uploaded = await page.addFiles([
      new File(['a'], 'a.md', { type: 'text/markdown' }),
      new File(['b'], 'b.md', { type: 'text/markdown' }),
    ])

    expect(uploaded).toBe(2)
    expect(order).toEqual(['a.md', 'b.md'])
    expect(api.listDocuments).toHaveBeenCalledTimes(1)
    expect(page.upload.value).toBeNull()
  })

  it('总字节为 0 时进度按 0 算而不是除出 NaN', async () => {
    vi.spyOn(api, 'uploadDocument').mockImplementation((_id, file, options) => {
      options?.onProgress?.({ loaded: 0, total: 0 })
      return Promise.resolve(documentOf(file.name))
    })
    const page = useKnowledgePage()
    page.selectedId.value = 'b1'
    const seen: number[] = []
    vi.spyOn(api, 'listDocuments').mockImplementation(() => {
      seen.push(page.upload.value?.ratio ?? -1)
      return Promise.resolve([])
    })

    await page.addFiles([new File([], 'a.md', { type: 'text/markdown' })])

    expect(seen).toEqual([0])
  })

  it('传到一半炸了也要把进度条收掉', async () => {
    // ⚠ 不收的话，界面会永远停在一个不动的进度条上
    vi.spyOn(api, 'uploadDocument').mockRejectedValue(new Error('存储满了'))
    const page = useKnowledgePage()
    page.selectedId.value = 'b1'

    const uploaded = await page.addFiles([
      new File(['a'], 'a.md', { type: 'text/markdown' }),
    ])

    expect(uploaded).toBe(0)
    expect(page.upload.value).toBeNull()
    expect(page.error.value).toBe('存储满了')
  })

  it('没选库时一个字节都不传', async () => {
    vi.spyOn(api, 'uploadDocument').mockResolvedValue(documentOf('d1'))
    const page = useKnowledgePage()

    await page.addFiles([new File(['a'], 'a.md', { type: 'text/markdown' })])

    expect(api.uploadDocument).not.toHaveBeenCalled()
  })
})

describe('文档动作与检索', () => {
  it('刷新文档同时更新异步来源新增计数，旧统计不能覆盖新统计', async () => {
    const oldCounts = deferred<KnowledgeBase>()
    vi.mocked(api.readBase)
      .mockReturnValueOnce(oldCounts.promise)
      .mockResolvedValueOnce({ ...baseOf('b1', '甲'), documentCount: 2 })
    const page = useKnowledgePage()
    page.bases.value = [baseOf('b1', '甲')]
    page.selectedId.value = 'b1'
    const first = page.refreshDocuments()
    await page.refreshDocuments()
    oldCounts.settle({ ...baseOf('b1', '甲'), documentCount: 1 })
    await first

    expect(page.selected.value?.documentCount).toBe(2)
  })

  it('统计读取失败保留已有数并明确报告，重试成功后恢复真实数', async () => {
    vi.mocked(api.readBase)
      .mockRejectedValueOnce(new Error('统计读取失败'))
      .mockResolvedValueOnce({ ...baseOf('b1', '甲'), documentCount: 3 })
    const page = useKnowledgePage()
    page.bases.value = [{ ...baseOf('b1', '甲'), documentCount: 2 }]
    page.selectedId.value = 'b1'

    await page.refreshDocuments()
    expect(page.selected.value?.documentCount).toBe(2)
    expect(page.error.value).toContain('统计读取失败')
    await page.refreshDocuments()
    expect(page.selected.value?.documentCount).toBe(3)
    expect(page.error.value).toBe('')
  })

  it('重解析与删文档都跟一次重取', async () => {
    vi.spyOn(api, 'reparseDocument').mockResolvedValue(documentOf('d1'))
    vi.spyOn(api, 'deleteDocument').mockResolvedValue(undefined)
    const page = useKnowledgePage()
    page.selectedId.value = 'b1'

    const reparsed = await page.reparse('d1')
    const removed = await page.removeDocument('d1')

    expect(reparsed).toBe(true)
    expect(removed).toBe(true)
    expect(api.listDocuments).toHaveBeenCalledTimes(2)
  })

  it('重取文档时忙碌标记跟着请求走', async () => {
    const slow = deferred<KnowledgeDocument[]>()
    vi.mocked(api.listDocuments).mockReturnValue(slow.promise)
    const page = useKnowledgePage()
    page.selectedId.value = 'b1'

    const pending = page.refreshDocuments()
    expect(page.isRefreshing.value).toBe(true)
    slow.settle([])
    await pending

    expect(page.isRefreshing.value).toBe(false)
  })

  it('空问句不发请求', async () => {
    vi.spyOn(api, 'searchBase').mockResolvedValue({
      hits: [],
      strategy: 'naive',
      note: '',
    })
    const page = useKnowledgePage()
    page.selectedId.value = 'b1'
    page.query.value = '   '

    await page.search()

    expect(api.searchBase).not.toHaveBeenCalled()
  })

  it('检索跑完把忙碌标记收掉，即使炸了', async () => {
    vi.spyOn(api, 'searchBase').mockRejectedValue(
      new TransportError(409, '这个库还检索不了'),
    )
    const page = useKnowledgePage()
    page.selectedId.value = 'b1'
    page.query.value = '锅炉'

    await page.search()

    expect(page.isSearching.value).toBe(false)
    expect(page.error.value).toBe('这个库还检索不了')
  })

  it('发出去的那句记在 searched 上，去掉首尾空白', async () => {
    vi.spyOn(api, 'searchBase').mockResolvedValue({
      hits: [],
      strategy: 'hybrid',
      note: '',
    })
    const page = useKnowledgePage()
    page.selectedId.value = 'b1'
    page.query.value = '  锅炉 '

    await page.search()

    expect(page.searched.value).toBe('锅炉')
  })
})

describe('首屏', () => {
  it('取能力与库清单，并选中第一个', async () => {
    vi.mocked(api.listBases).mockResolvedValue([
      baseOf('b1', '甲'),
      baseOf('b2', '乙'),
    ])
    const page = useKnowledgePage()

    await page.reload()

    expect(page.selectedId.value).toBe('b1')
    expect(page.accept.value).toBe('.md,.docx')
    expect(page.isLoading.value).toBe(false)
  })

  it('一个库都没有时不选也不炸', async () => {
    const page = useKnowledgePage()

    await page.reload()

    expect(page.selectedId.value).toBe('')
    expect(page.error.value).toBe('')
  })

  it('取能力就炸了也要把忙碌标记收掉', async () => {
    // ⚠ 不收的话整页永远停在骨架屏上，连那句错都看不见
    vi.mocked(api.readCapability).mockRejectedValue(new Error('后端没起'))
    const page = useKnowledgePage()

    await page.reload()

    expect(page.isLoading.value).toBe(false)
    expect(page.error.value).toBe('后端没起')
  })

  it('走在回退档上时把原因摆出来', async () => {
    vi.mocked(api.readCapability).mockResolvedValue({
      isEmbeddingEnabled: false,
      isModelEnabled: false,
      isAsrEnabled: false,
      strategies: ['naive'],
      readyStrategies: [],
      sourceKinds: ['upload', 'platform'],
      acceptedSuffixes: [],
      index: {
        vector: 'pgvector',
        keyword: 'trgm',
        reason: '这套部署的向量列是 1536 维，模型算出来的是 1024 维',
      },
      rerank: {
        isEnabled: false,
        model: '',
        reason: '还没给「知识库重排」分配模型',
      },
    })
    const page = useKnowledgePage()

    await page.reload()

    expect(page.indexHint.value).toBe(
      '这套部署的向量列是 1536 维，模型算出来的是 1024 维',
    )
  })
})

describe('首次跨页浏览与清单竞态', () => {
  it('首次101库完整可发现，选择最旧库、刷新及重载均保留真实计数', async () => {
    vi.mocked(api.listBases).mockRestore()
    vi.mocked(api.readBase).mockRestore()
    const read = vi
      .fn()
      .mockImplementation((_path: string, options?: RequestOptions) => {
        if (_path === '/knowledge-bases/oldest')
          return Promise.resolve(baseWire('oldest', 3))
        const page = options?.query?.page
        return Promise.resolve(
          page === 1
            ? {
                items: Array.from({ length: 100 }, (_, id) =>
                  baseWire(`b${id}`, 0),
                ),
                page: 1,
                size: 100,
                total: 101,
              }
            : {
                items: [baseWire('oldest', 3)],
                page: 2,
                size: 100,
                total: 101,
              },
        )
      })
    vi.spyOn(client, 'requestData').mockImplementation(read)
    const page = useKnowledgePage()
    await page.reload()
    expect(page.bases.value).toHaveLength(101)
    expect(page.bases.value.at(-1)?.id).toBe('oldest')
    expect(page.selectedId.value).toBe('b0')
    await page.select('oldest')
    await page.refreshDocuments()
    await page.reload()
    expect(page.selectedId.value).toBe('oldest')
    expect(page.selected.value?.documentCount).toBe(3)
    expect(read).toHaveBeenCalledTimes(5)
  })

  it('后次清单先完成时中止前次分页且旧结果不回填', async () => {
    const old = deferred<KnowledgeBase[]>()
    vi.mocked(api.listBases)
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce([baseOf('latest', '最新库')])
    const page = useKnowledgePage()
    const first = page.reload()
    await vi.waitFor(() => expect(api.listBases).toHaveBeenCalledOnce())
    await page.reload()
    old.settle([baseOf('stale', '旧库')])
    await first
    expect(page.bases.value.map((base) => base.id)).toEqual(['latest'])
    expect(page.selectedId.value).toBe('latest')
    expect(vi.mocked(api.listBases).mock.calls[0]?.[0]?.aborted).toBe(true)
  })

  it('卸载后首个清单迟到不回填也不再加载文档', async () => {
    const old = deferred<KnowledgeBase[]>()
    vi.mocked(api.listBases).mockReturnValue(old.promise)
    const scope = effectScope()
    const page = scope.run(useKnowledgePage)
    if (page === undefined) throw new Error('未创建页面')
    const loading = page.reload()
    await vi.waitFor(() => expect(api.listBases).toHaveBeenCalledOnce())
    scope.stop()
    old.settle([baseOf('stale', '迟到库')])
    await loading
    expect(page.bases.value).toEqual([])
    expect(api.listDocuments).not.toHaveBeenCalled()
  })
})

it('能力加载时卸载，不回填能力或再发清单请求', async () => {
  const pending = deferred<Awaited<ReturnType<typeof api.readCapability>>>()
  vi.mocked(api.readCapability).mockReturnValue(pending.promise)
  const scope = effectScope()
  const page = scope.run(useKnowledgePage)
  if (page === undefined) throw new Error('未创建页面')
  const loading = page.reload()
  const capability = {
    isEmbeddingEnabled: true,
    isModelEnabled: true,
    isAsrEnabled: false,
    sourceKinds: [],
    strategies: [],
    readyStrategies: [],
    acceptedSuffixes: [],
    index: { vector: 'pgvector', keyword: 'trgm', reason: '' },
    rerank: { isEnabled: false, model: '', reason: '' },
  }
  scope.stop()
  pending.settle(capability)
  await loading
  expect(page.capability.value).toBeNull()
  expect(api.listBases).not.toHaveBeenCalled()
})

it('清单加载期间创建库，迟到旧列表不能擦掉新库', async () => {
  const old = deferred<KnowledgeBase[]>()
  vi.mocked(api.listBases).mockReturnValue(old.promise)
  vi.spyOn(api, 'createBase').mockResolvedValue(baseOf('new', '新库'))
  const page = useKnowledgePage()
  const loading = page.reload()
  await vi.waitFor(() => expect(api.listBases).toHaveBeenCalledOnce())
  await page.create('新库', '')
  old.settle([baseOf('old', '旧库')])
  await loading
  expect(page.bases.value.map((base) => base.id)).toEqual(['new'])
  expect(page.selectedId.value).toBe('new')
})

it('文档轮询只刷新当前库计数，不重新读取全库列表', async () => {
  const read = vi
    .spyOn(api, 'readBase')
    .mockResolvedValue({ ...baseOf('b100', '最早库'), documentCount: 2 })
  const page = useKnowledgePage()
  page.bases.value = Array.from({ length: 101 }, (_, id) =>
    baseOf(`b${id}`, `库${id}`),
  )
  page.selectedId.value = 'b100'
  await page.refreshDocuments()
  expect(api.listBases).not.toHaveBeenCalled()
  expect(read).toHaveBeenCalledExactlyOnceWith('b100', expect.any(AbortSignal))
  expect(page.selected.value?.documentCount).toBe(2)
})

it('全清单重载期间的文档轮询不能中止分页或擦掉新清单', async () => {
  const pending = deferred<KnowledgeBase[]>()
  vi.mocked(api.listBases).mockReturnValue(pending.promise)
  const page = useKnowledgePage()
  page.bases.value = [baseOf('selected', '当前库')]
  page.selectedId.value = 'selected'
  const loading = page.reload()
  await vi.waitFor(() => expect(api.listBases).toHaveBeenCalledOnce())
  await page.refreshDocuments()
  pending.settle([baseOf('selected', '当前库'), baseOf('oldest', '最早库')])
  await loading
  expect(vi.mocked(api.listBases).mock.calls[0]?.[0]?.aborted).toBe(false)
  expect(api.readBase).not.toHaveBeenCalled()
  expect(page.bases.value.map((base) => base.id)).toEqual([
    'selected',
    'oldest',
  ])
})

describe('切库失败的文档隔离', () => {
  it('新库请求失败后不把上一库文档留在新库名下', async () => {
    vi.mocked(api.listDocuments)
      .mockResolvedValueOnce([documentOf('a-only')])
      .mockRejectedValueOnce(new Error('新库读取失败'))
    const page = useKnowledgePage()
    page.bases.value = [baseOf('a', '甲'), baseOf('b', '乙')]
    await page.select('a')
    await page.select('b')
    expect(page.selected.value?.id).toBe('b')
    expect(page.error.value).toBe('新库读取失败')
    expect(page.documents.value).toEqual([])
  })

  it('同一库刷新失败保留已读取文档并提示失败', async () => {
    vi.mocked(api.listDocuments)
      .mockResolvedValueOnce([documentOf('a-only')])
      .mockRejectedValueOnce(new Error('刷新失败'))
    const page = useKnowledgePage()
    await page.select('a')
    await page.select('a')
    expect(page.documents.value.map((one) => one.id)).toEqual(['a-only'])
    expect(page.error.value).toBe('刷新失败')
  })

  it('切库后等待请求期间立即清除旧文档，旧库迟到不回填', async () => {
    const slow = deferred<KnowledgeDocument[]>()
    vi.mocked(api.listDocuments)
      .mockResolvedValueOnce([documentOf('a-only')])
      .mockReturnValueOnce(slow.promise)
    const page = useKnowledgePage()
    await page.select('a')
    const switching = page.select('b')
    expect(page.documents.value).toEqual([])
    slow.settle([documentOf('b-only')])
    await switching
    expect(page.documents.value.map((one) => one.id)).toEqual(['b-only'])
  })
})
