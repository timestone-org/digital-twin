/** @fileoverview 完整目录搜索必须跨页、正确计数，并拒绝部分结果。 */
import type { ModelingBdmCatalog, ModelingBdmCatalogItem } from '@dt/contracts'
import { describe, expect, it, vi } from 'vitest'

import { createBdmCatalogReader } from '@/pages/Modeling/Canvas/scripts/bdmCatalogSearch'
import type { BdmCatalogRequest } from '@/pages/Modeling/Canvas/scripts/bdmCatalogSearch'

function items(count: number): ModelingBdmCatalogItem[] {
  return Array.from({ length: count }, (_, index) => ({
    identifier: `id-${index}`,
    code: `CODE_${index}`,
    name: `记录 ${index}`,
    system: null,
    history_available: null,
  }))
}

function page(
  query: BdmCatalogRequest,
  records: ModelingBdmCatalogItem[],
): ModelingBdmCatalog {
  const size = query.size ?? 50
  return {
    kind: query.kind,
    page: query.page,
    size,
    total: records.length,
    system_filter_available: null,
    items: records.slice((query.page - 1) * size, query.page * size),
  }
}

function signal(): AbortSignal {
  return new AbortController().signal
}
const progress = () => undefined

describe('属性与公式的全目录搜索', () => {
  it.each(['raw', 'formula'] as const)(
    '%s 能找到第二批中的记录',
    async (kind) => {
      const records = items(201)
      records[200] = {
        identifier: 'last',
        code: 'LAST',
        name: '目标温度',
        system: null,
        history_available: null,
      }
      const fetchPage = vi.fn((query: BdmCatalogRequest) =>
        Promise.resolve(page(query, records)),
      )
      const reader = createBdmCatalogReader(fetchPage, () => 0)
      const found = await reader.read(
        { kind, page: 1, keyword: '目标' },
        signal(),
        progress,
      )
      expect(found.total).toBe(1)
      expect(found.items.map((item) => item.identifier)).toEqual(['last'])
      expect(
        fetchPage.mock.calls.map(([query]) => [
          query.page,
          query.size,
          query.keyword,
        ]),
      ).toEqual([
        [1, 200, undefined],
        [2, 200, undefined],
      ])
    },
  )

  it('按名称、编码、标识和系统匹配，忽略大小写和首尾空白', async () => {
    const records = [
      {
        identifier: 'sensor-x',
        code: 'Temp_A',
        name: '出口温度',
        system: '空压系统',
        history_available: null,
      },
    ]
    const fetchPage = vi.fn((query: BdmCatalogRequest) =>
      Promise.resolve(page(query, records)),
    )
    const reader = createBdmCatalogReader(fetchPage, () => 0)
    for (const keyword of ['温度', ' temp_a ', 'SENSOR-X', '空压']) {
      const found = await reader.read(
        { kind: 'raw', page: 1, keyword },
        signal(),
        progress,
      )
      expect(found.items.map((item) => item.identifier)).toEqual(['sensor-x'])
    }
    expect(fetchPage).toHaveBeenCalledTimes(1)
  })

  it('搜索结果分页使用过滤后的总数，翻页复用完整目录', async () => {
    const records = items(210).map((item, index) => ({
      ...item,
      name: index % 2 === 0 ? '温度' : '压力',
    }))
    const fetchPage = vi.fn((query: BdmCatalogRequest) =>
      Promise.resolve(page(query, records)),
    )
    const reader = createBdmCatalogReader(fetchPage, () => 0)
    const first = await reader.read(
      { kind: 'formula', page: 1, keyword: '温度' },
      signal(),
      progress,
    )
    const second = await reader.read(
      { kind: 'formula', page: 2, keyword: '温度' },
      signal(),
      progress,
    )
    expect(first.total).toBe(105)
    expect(second.total).toBe(105)
    expect(second.items).toHaveLength(50)
    expect(second.items[0]?.identifier).toBe('id-100')
    expect(fetchPage).toHaveBeenCalledTimes(2)
  })

  it('普通浏览只读一页，点位搜索继续由上游过滤', async () => {
    const fetchPage = vi.fn((query: BdmCatalogRequest) =>
      Promise.resolve(page(query, items(201))),
    )
    const reader = createBdmCatalogReader(fetchPage, () => 0)
    await reader.read({ kind: 'raw', page: 2, keyword: '' }, signal(), progress)
    await reader.read(
      { kind: 'point', page: 1, keyword: '温度' },
      signal(),
      progress,
    )
    expect(fetchPage.mock.calls.map(([query]) => query)).toEqual([
      { kind: 'raw', page: 2, keyword: undefined },
      { kind: 'point', page: 1, keyword: '温度' },
    ])
  })

  it('目录过期或用户刷新后重新读取', async () => {
    let now = 0
    const fetchPage = vi.fn((query: BdmCatalogRequest) =>
      Promise.resolve(page(query, items(1))),
    )
    const reader = createBdmCatalogReader(fetchPage, () => now)
    const query = { kind: 'raw', page: 1, keyword: '记录' } as const
    await reader.read(query, signal(), progress)
    now = 299_999
    await reader.read(query, signal(), progress)
    expect(fetchPage).toHaveBeenCalledTimes(1)
    now = 300_000
    await reader.read(query, signal(), progress)
    reader.clear('raw')
    await reader.read(query, signal(), progress)
    expect(fetchPage).toHaveBeenCalledTimes(3)
  })

  it('后页失败时不返回前页的匹配，也不缓存半份目录', async () => {
    let shouldFail = true
    const fetchPage = vi.fn(async (query: BdmCatalogRequest) => {
      await Promise.resolve()
      if (query.page === 2 && shouldFail) throw new Error('后页失败')
      return page(query, items(201))
    })
    const reader = createBdmCatalogReader(fetchPage, () => 0)
    const query = { kind: 'raw', page: 1, keyword: '记录' } as const
    await expect(reader.read(query, signal(), progress)).rejects.toThrow(
      '后页失败',
    )
    shouldFail = false
    expect((await reader.read(query, signal(), progress)).total).toBe(201)
    expect(
      fetchPage.mock.calls.filter(([request]) => request.page === 1),
    ).toHaveLength(2)
  })

  it('取消后停止加载并丢弃未完成的目录', async () => {
    const controller = new AbortController()
    const fetchPage = vi.fn(async (query: BdmCatalogRequest) => {
      await Promise.resolve()
      if (query.page === 2) controller.abort()
      return page(query, items(1001))
    })
    const reader = createBdmCatalogReader(fetchPage, () => 0)
    await expect(
      reader.read(
        { kind: 'raw', page: 1, keyword: '记录' },
        controller.signal,
        progress,
      ),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchPage.mock.calls.some(([query]) => query.page === 6)).toBe(false)
  })

  it.each(['total', 'duplicate', 'short', 'wrong-kind'] as const)(
    '%s 异常不能伪装成完整结果',
    async (issue) => {
      const fetchPage = vi.fn(async (query: BdmCatalogRequest) => {
        await Promise.resolve()
        const result = page(query, items(201))
        if (issue === 'wrong-kind') return { ...result, kind: 'point' as const }
        if (query.page !== 2) return result
        if (issue === 'total') return { ...result, total: 202 }
        if (issue === 'duplicate') return { ...result, items: items(1) }
        return { ...result, items: [] }
      })
      const reader = createBdmCatalogReader(fetchPage, () => 0)
      await expect(
        reader.read(
          { kind: 'raw', page: 1, keyword: '记录' },
          signal(),
          progress,
        ),
      ).rejects.toThrow()
    },
  )

  it('拒绝超过容量的目录', async () => {
    const fetchPage = vi.fn((query: BdmCatalogRequest) =>
      Promise.resolve({
        ...page(query, []),
        total: 50_001,
      }),
    )
    const reader = createBdmCatalogReader(fetchPage, () => 0)
    await expect(
      reader.read(
        { kind: 'formula', page: 1, keyword: '记录' },
        signal(),
        progress,
      ),
    ).rejects.toThrow('50000')
    expect(fetchPage).toHaveBeenCalledTimes(1)
  })

  it('完整扫描有总耗时边界', async () => {
    let now = 0
    const fetchPage = vi.fn(async (query: BdmCatalogRequest) => {
      await Promise.resolve()
      now = 120_001
      return page(query, items(201))
    })
    const reader = createBdmCatalogReader(fetchPage, () => now)
    await expect(
      reader.read(
        { kind: 'formula', page: 1, keyword: '记录' },
        signal(),
        progress,
      ),
    ).rejects.toThrow('超时')
  })

  it('并发最多四页，进度到达完整总数', async () => {
    let active = 0
    let peak = 0
    const fetchPage = vi.fn(async (query: BdmCatalogRequest) => {
      active += 1
      peak = Math.max(peak, active)
      await Promise.resolve()
      active -= 1
      return page(query, items(1001))
    })
    const report = vi.fn()
    const reader = createBdmCatalogReader(fetchPage, () => 0)
    await reader.read(
      { kind: 'raw', page: 1, keyword: '不存在' },
      signal(),
      report,
    )
    expect(peak).toBe(4)
    expect(report.mock.calls.at(-1)).toEqual([{ loaded: 1001, total: 1001 }])
  })
})
