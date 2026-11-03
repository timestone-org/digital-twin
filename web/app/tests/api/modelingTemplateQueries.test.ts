/** @fileoverview 建模列表省略空搜索参数，实例列表遵循非空查询词契约。 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { configureApiClient } from '@/api/client'
import * as api from '@/api/modelingTemplates'

const page = { items: [], page: 1, size: 20, total: 0 }
const fetch = vi.fn<typeof globalThis.fetch>()
const readers = [
  { path: '/modeling-templates', read: api.listTemplates },
  { path: '/modeling-instances', read: api.listInstances },
]

function requestUrl(): URL {
  const input = fetch.mock.calls.at(-1)?.[0]
  if (typeof input !== 'string') throw new Error('缺少真实序列化URL')
  return new URL(input, 'http://localhost')
}

beforeEach(() => {
  fetch.mockReset()
  fetch.mockImplementation((input) => {
    if (typeof input !== 'string') throw new Error('接口未生成URL')
    const url = new URL(input, 'http://localhost')
    const query = url.searchParams
    const isRejected =
      url.pathname.endsWith('/modeling-instances') &&
      query.has('q') &&
      query.get('q') === ''
    return Promise.resolve(
      new Response(
        JSON.stringify({
          code: isRejected ? 40001 : 0,
          message: isRejected ? '参数校验失败' : 'ok',
          data: isRejected ? null : page,
          trace_id: 'query-contract',
        }),
        { status: isRejected ? 400 : 200 },
      ),
    )
  })
  vi.stubGlobal('fetch', fetch)
  configureApiClient({ getToken: () => null })
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  configureApiClient({ getToken: () => null })
})

it.each(readers)(
  '$path 省略空搜索词，初始列表和清空搜索均可读取',
  async ({ path, read }) => {
    for (const q of [undefined, '', '   ', '\t\n']) {
      const query = { page: 1, size: 20, ...(q === undefined ? {} : { q }) }
      await expect(read(query)).resolves.toEqual(page)
      const url = requestUrl()
      expect(url.pathname).toBe(`/api/v1/platform${path}`)
      expect(url.searchParams.has('q')).toBe(false)
      expect(url.searchParams.get('page')).toBe('1')
      expect(url.searchParams.get('size')).toBe('20')
      expect(query.q).toBe(q)
    }
  },
)

it.each(readers)(
  '$path 发送去除首尾空格的查询词并保留取消信号',
  async ({ path, read }) => {
    const controller = new AbortController()
    const query = { page: 2, size: 10, q: '  冷机 能耗  ' }
    await read(query, controller.signal)
    const url = requestUrl()
    expect(url.pathname).toBe(`/api/v1/platform${path}`)
    expect(url.searchParams.get('q')).toBe('冷机 能耗')
    expect(url.searchParams.get('page')).toBe('2')
    expect(url.searchParams.get('size')).toBe('10')
    expect(query.q).toBe('  冷机 能耗  ')
    const signal = fetch.mock.calls.at(-1)?.[1]?.signal
    controller.abort()
    expect(signal?.aborted).toBe(true)
  },
)

it('共享读包装保留历史配置run_id且不附加搜索参数', async () => {
  await api.getInstanceConfiguration('instance-1', undefined, 'run-1')
  expect(requestUrl().pathname).toBe(
    '/api/v1/platform/modeling-instances/instance-1/configuration',
  )
  expect(requestUrl().search).toBe('?run_id=run-1')
})
