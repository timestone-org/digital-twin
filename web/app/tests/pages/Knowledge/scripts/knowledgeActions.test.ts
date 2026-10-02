/** @fileoverview 知识库检索只展示当前库的最新结果，切库、删除和卸载取消请求。 */
import { effectScope } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as api from '@/api/knowledge'
import type { KnowledgeSearchResult } from '@/api/knowledge'
import { useKnowledgePage } from '@/pages/Knowledge/scripts/useKnowledgePage'

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined
  let reject: (reason: Error) => void = () => undefined
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

function result(note: string): KnowledgeSearchResult {
  return { hits: [], strategy: 'hybrid', note }
}

function pageOf() {
  const page = useKnowledgePage()
  page.selectedId.value = 'b1'
  page.query.value = '锅炉'
  return page
}

beforeEach(() => {
  vi.spyOn(api, 'listDocuments').mockResolvedValue([])
  vi.spyOn(api, 'deleteBase').mockResolvedValue(undefined)
  vi.spyOn(api, 'searchBase').mockResolvedValue(result('最新结果'))
})

afterEach(() => vi.restoreAllMocks())

describe('检索竞态', () => {
  it('切库取消在飞请求，旧库结果不回填新库', async () => {
    const slow = deferred<KnowledgeSearchResult>()
    vi.mocked(api.searchBase).mockReturnValueOnce(slow.promise)
    const page = pageOf()
    const searching = page.search()
    const signal = vi.mocked(api.searchBase).mock.calls[0]?.[3]
    await page.select('b2')
    expect(signal?.aborted).toBe(true)
    expect(page.isSearching.value).toBe(false)
    slow.resolve(result('旧库结果'))
    await searching
    expect(page.result.value).toBeNull()
    expect(page.searched.value).toBe('')
    expect(page.error.value).toBe('')
  })

  it('同库多次检索乱序返回时结果与高亮问句保持最新', async () => {
    const slow = deferred<KnowledgeSearchResult>()
    vi.mocked(api.searchBase).mockReturnValueOnce(slow.promise)
    const page = pageOf()
    const first = page.search()
    const signal = vi.mocked(api.searchBase).mock.calls[0]?.[3]
    page.query.value = '汽轮机'
    await page.search()
    expect(signal?.aborted).toBe(true)
    slow.resolve(result('旧问句结果'))
    await first
    expect(page.result.value?.note).toBe('最新结果')
    expect(page.searched.value).toBe('汽轮机')
  })

  it('旧请求结束不能提前收掉新请求的忙碌标记', async () => {
    const first = deferred<KnowledgeSearchResult>()
    const second = deferred<KnowledgeSearchResult>()
    vi.mocked(api.searchBase)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    const page = pageOf()
    const old = page.search()
    page.query.value = '汽轮机'
    const latest = page.search()
    first.resolve(result('旧结果'))
    await old
    expect(page.isSearching.value).toBe(true)
    second.resolve(result('新结果'))
    await latest
    expect(page.isSearching.value).toBe(false)
    expect(page.result.value?.note).toBe('新结果')
  })

  it('旧请求失败不覆盖最新检索成功的界面', async () => {
    const slow = deferred<KnowledgeSearchResult>()
    vi.mocked(api.searchBase).mockReturnValueOnce(slow.promise)
    const page = pageOf()
    const old = page.search()
    page.query.value = '汽轮机'
    await page.search()
    slow.reject(new Error('旧请求失败'))
    await old
    expect(page.error.value).toBe('')
    expect(page.result.value?.note).toBe('最新结果')
  })

  it('当前检索失败显示原因并收掉忙碌标记', async () => {
    vi.mocked(api.searchBase).mockRejectedValue(new Error('检索失败'))
    const page = pageOf()
    await page.search()
    expect(page.error.value).toBe('检索失败')
    expect(page.isSearching.value).toBe(false)
  })

  it('卸载取消请求，忽略迟到结果', async () => {
    const slow = deferred<KnowledgeSearchResult>()
    vi.mocked(api.searchBase).mockReturnValueOnce(slow.promise)
    const scope = effectScope()
    const page = scope.run(pageOf)
    if (page === undefined) throw new Error('未创建页面')
    const searching = page.search()
    const signal = vi.mocked(api.searchBase).mock.calls[0]?.[3]
    scope.stop()
    expect(signal?.aborted).toBe(true)
    slow.resolve(result('卸载后返回'))
    await searching
    expect(page.result.value).toBeNull()
  })

  it('删除当前库取消检索并清空原结果和问句', async () => {
    const slow = deferred<KnowledgeSearchResult>()
    const page = pageOf()
    await page.search()
    vi.mocked(api.searchBase).mockReturnValueOnce(slow.promise)
    const searching = page.search()
    const signal = vi.mocked(api.searchBase).mock.calls[1]?.[3]
    await page.drop('b1')
    expect(signal?.aborted).toBe(true)
    expect(page.result.value).toBeNull()
    expect(page.searched.value).toBe('')
    slow.resolve(result('已删除库'))
    await searching
    expect(page.result.value).toBeNull()
  })
})
