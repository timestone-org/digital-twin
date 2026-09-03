/**
 * @fileoverview 知识库页的编排：防竞态、切库清场、报错说人话、上传逐个来。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as api from '@/api/knowledge'
import { TransportError } from '@/api/client'
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
    createdAt: '2026-09-01T00:00:00.000Z',
    readyAt: '2026-09-01T00:00:01.000Z',
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
  vi.spyOn(api, 'readCapability').mockResolvedValue({
    isEmbeddingEnabled: true,
    isModelEnabled: true,
    isAsrEnabled: false,
    strategies: ['naive', 'hybrid', 'agentic'],
    readyStrategies: ['naive', 'hybrid'],
    acceptedSuffixes: ['.md', '.docx'],
    index: { vector: 'pgvector', keyword: 'trgm', reason: '' },
    rerank: {
      isEnabled: false,
      model: '',
      reason: '还没给「知识库重排」分配模型',
    },
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
