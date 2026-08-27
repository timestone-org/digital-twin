/**
 * @fileoverview 契约：挑点面板的搜索防竞态——关键字是连着敲出来的，
 * 先发后回的那次不许把结果覆盖成上一个关键字的；以及数据源清单取不到时
 * 退化成「只能按关键字搜」，而不是把整个面板堵死。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Page } from '@dt/contracts'

import * as collectApi from '@/api/collect'
import type { CollectPoint, CollectSource } from '@dt/contracts'
import { BizError } from '@/api/client'
import { usePointPicker } from '@/composables/usePointPicker'

function point(code: string): CollectPoint {
  return {
    id: code,
    source_id: 's1',
    node_key: `s1:${code}`,
    code,
    name: `点位 ${code}`,
    address: `ns=2;s=${code}`,
    data_type: 'float',
    unit: null,
    sampling_interval_ms: 1000,
    deadband: 0,
    archive_enabled: true,
    archive_max_interval_ms: 60000,
    archive_retention_days: null,
    created_at: '2026-08-16T00:00:00.000Z',
    updated_at: '2026-08-16T00:00:00.000Z',
  }
}

function page(items: CollectPoint[], total = items.length): Page<CollectPoint> {
  return { items, total, page: 1, size: 50 }
}

function source(over: Partial<CollectSource> = {}): CollectSource {
  return {
    id: 's1',
    name: '一号车间 PLC',
    code: 'plant1',
    protocol: 'opcua',
    description: null,
    endpoint: 'opc.tcp://10.0.0.2:4840',
    username: null,
    has_credential: false,
    options_json: {},
    read_mode: 'subscribe',
    poll_interval_ms: 1000,
    is_enabled: true,
    point_count: 1,
    live_point_limit: 1000,
    runtime: {
      state: 'online',
      point_count: 1,
      error_category: null,
      error_detail: null,
      leader_instance: 'c1',
      updated_at: null,
    },
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
    ...over,
  }
}

function sourcePage(items: CollectSource[]): Page<CollectSource> {
  return { items, total: items.length, page: 1, size: 200 }
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('搜索', () => {
  it('把关键字与数据源传给接口，空串按不筛处理', async () => {
    const list = vi
      .spyOn(collectApi, 'listPoints')
      .mockResolvedValue(page([point('t1')]))
    const picker = usePointPicker()

    await picker.search()

    expect(list.mock.calls[0]?.[0]).toMatchObject({
      q: undefined,
      sourceId: undefined,
      page: 1,
    })
    expect(picker.items.value).toHaveLength(1)
  })

  it('关键字与数据源都传下去', async () => {
    const list = vi.spyOn(collectApi, 'listPoints').mockResolvedValue(page([]))
    const picker = usePointPicker()
    picker.keyword.value = '  温度  '
    picker.sourceId.value = 's1'

    await picker.search()

    expect(list.mock.calls[0]?.[0]).toMatchObject({
      q: '温度',
      sourceId: 's1',
    })
  })

  it('乱序返回时只有最后一次能写结果', async () => {
    const slow = deferred<Page<CollectPoint>>()
    const quick = deferred<Page<CollectPoint>>()
    vi.spyOn(collectApi, 'listPoints')
      .mockReturnValueOnce(slow.promise)
      .mockReturnValueOnce(quick.promise)
    const picker = usePointPicker()

    const first = picker.search()
    const second = picker.search()
    quick.resolve(page([point('new')]))
    slow.resolve(page([point('old')]))
    await Promise.all([first, second])

    expect(picker.items.value.map((item) => item.code)).toEqual(['new'])
  })

  it('失败时清空列表并给出一句能看的话', async () => {
    vi.spyOn(collectApi, 'listPoints').mockRejectedValue(
      new BizError(40300, '没有权限', 403, 't'),
    )
    const picker = usePointPicker()

    await picker.search()

    expect(picker.items.value).toEqual([])
    expect(picker.error.value).toBe('没有权限')
    expect(picker.loading.value).toBe(false)
  })

  it('掐掉在途请求之后，那一次的失败不再写状态', async () => {
    const pending = deferred<Page<CollectPoint>>()
    vi.spyOn(collectApi, 'listPoints').mockReturnValue(
      pending.promise.then(() => {
        throw new BizError(50000, '炸了', 500, 't')
      }),
    )
    const picker = usePointPicker()

    const search = picker.search()
    picker.dispose()
    pending.resolve(page([]))
    await search

    expect(picker.error.value).toBeNull()
  })
})

describe('数据源清单', () => {
  it('缺省只有「全部数据源」一档，拉回来之后每个源一档并带上协议', async () => {
    vi.spyOn(collectApi, 'listSources').mockResolvedValue(
      sourcePage([source()]),
    )
    const picker = usePointPicker()

    expect(picker.sourceOptions.value).toEqual([
      { value: '', label: '全部数据源' },
    ])
    await picker.loadSources()

    expect(picker.sourceOptions.value.at(-1)).toEqual({
      value: 's1',
      label: '一号车间 PLC · OPC UA',
    })
  })

  it('认得出点位归哪个源；不在清单里的给空串，绝不瞎猜一个名字', async () => {
    vi.spyOn(collectApi, 'listSources').mockResolvedValue(
      sourcePage([source()]),
    )
    const picker = usePointPicker()
    await picker.loadSources()

    expect(picker.sourceName('s1')).toBe('一号车间 PLC')
    expect(picker.sourceName('s9')).toBe('')
  })

  // ⚠ 数据源清单是筛选与认人用的，不是挑点的前置条件：它失败时把原因说出来，
  // 但点位照搜不误
  it('拉不到清单时留下原因，档位退回只剩「全部数据源」', async () => {
    vi.spyOn(collectApi, 'listSources').mockRejectedValue(
      new BizError(50000, '炸了', 500, 't'),
    )
    const picker = usePointPicker()

    await picker.loadSources()

    expect(picker.sourceError.value).toBe('炸了')
    expect(picker.sourceOptions.value).toHaveLength(1)
  })
})

describe('列没列全', () => {
  it('总数比这一页多就是没列全', async () => {
    vi.spyOn(collectApi, 'listPoints').mockResolvedValue(
      page([point('t1')], 120),
    )
    const picker = usePointPicker()

    await picker.search()

    expect(picker.hasMore.value).toBe(true)
  })

  it('列全了就不算没列全', async () => {
    vi.spyOn(collectApi, 'listPoints').mockResolvedValue(page([point('t1')]))
    const picker = usePointPicker()

    await picker.search()

    expect(picker.hasMore.value).toBe(false)
  })
})
