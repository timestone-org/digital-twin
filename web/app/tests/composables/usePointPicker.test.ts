/**
 * @fileoverview 契约：挑点面板的搜索防竞态——关键字是连着敲出来的，
 * 先发后回的那次不许把结果覆盖成上一个关键字的；以及数据源清单取不到时
 * 退化成「只能按关键字搜」，而不是把整个面板堵死。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Page, PointMatchesOut, PointMatchOut } from '@dt/contracts'

import * as collectApi from '@/api/collect'
import * as searchApi from '@/api/collectSearch'
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

function match(code = 'temp'): PointMatchOut {
  return {
    id: code,
    node_key: `s1:${code}`,
    code,
    name: '余热水箱测温',
    source_id: 's1',
    source_name: '能源站',
    source_protocol: 'modbus_tcp',
    description: '余热回收水箱温度',
    unit: '℃',
    is_enabled: true,
    is_exact: false,
    score: 0.9,
  }
}
function matches(code = 'temp'): PointMatchesOut {
  return { items: [match(code)], mode: 'hybrid', pending_count: 0 }
}

describe('语义搜索与候选核对', () => {
  it('传递自然语言与数据源，返回相关性候选而不伪造总数', async () => {
    const search = vi
      .spyOn(searchApi, 'searchCollectPoints')
      .mockResolvedValue({
        ...matches(),
        pending_count: 3,
        note: '有3个点位正在等待语义索引',
      })
    const picker = usePointPicker(true)
    picker.keyword.value = '  水箱温度  '
    picker.sourceId.value = 's1'
    await picker.search()
    expect(search).toHaveBeenCalledWith(
      '水箱温度',
      's1',
      expect.any(AbortSignal),
    )
    expect(picker.matches.value?.pending_count).toBe(3)
    expect(picker.matches.value?.note).toContain('等待语义索引')
    expect(picker.hasMore.value).toBe(false)
  })

  it('空输入走列表；切回关键词时旧语义响应不覆盖列表', async () => {
    const slow = deferred<PointMatchesOut>()
    vi.spyOn(searchApi, 'searchCollectPoints').mockReturnValue(slow.promise)
    vi.spyOn(collectApi, 'listPoints').mockResolvedValue(page([point('new')]))
    const picker = usePointPicker(true)
    picker.keyword.value = '水箱温度'
    const first = picker.search()
    picker.keyword.value = '  '
    await picker.search()
    slow.resolve(matches('old'))
    await first
    expect(picker.matches.value).toBeNull()
    expect(picker.items.value[0]?.code).toBe('new')
  })

  it('乱序语义响应不能覆盖最近结果与状态', async () => {
    const slow = deferred<PointMatchesOut>()
    vi.spyOn(searchApi, 'searchCollectPoints')
      .mockReturnValueOnce(slow.promise)
      .mockResolvedValueOnce(matches('new'))
    const picker = usePointPicker(true)
    picker.keyword.value = '旧设备'
    const first = picker.search()
    picker.keyword.value = '新设备'
    await picker.search()
    slow.resolve({ ...matches('old'), mode: 'keyword', note: '旧请求降级' })
    await first
    expect(picker.matches.value?.items[0]?.code).toBe('new')
    expect(picker.matches.value?.mode).toBe('hybrid')
  })

  it('超长输入显示明确原因，不请求模型', async () => {
    const search = vi.spyOn(searchApi, 'searchCollectPoints')
    const picker = usePointPicker(true)
    picker.keyword.value = '温'.repeat(301)
    await picker.search()
    expect(picker.error.value).toBe('点位描述请控制在300字以内')
    expect(search).not.toHaveBeenCalled()
  })

  it('搜索被拒绝时清空候选并展示原因', async () => {
    vi.spyOn(searchApi, 'searchCollectPoints')
      .mockResolvedValueOnce(matches())
      .mockRejectedValueOnce(new BizError(40300, '没有权限', 403, 't'))
    const picker = usePointPicker(true)
    picker.keyword.value = '温度'
    await picker.search()
    await picker.search()
    expect(picker.matches.value).toBeNull()
    expect(picker.error.value).toBe('没有权限')
  })

  it('核对完整配置时跳过相似编码并继续翻页精确匹配身份', async () => {
    vi.spyOn(collectApi, 'listPoints')
      .mockResolvedValueOnce({ ...page([point('temp1')], 201), size: 200 })
      .mockResolvedValueOnce({
        ...page([point('temp')], 201),
        page: 2,
        size: 200,
      })
    const picker = usePointPicker(true)
    expect(await picker.resolve(match())).toEqual(point('temp'))
    expect(collectApi.listPoints).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 2, sourceId: 's1', q: 'temp' }),
      expect.any(AbortSignal),
    )
  })

  it('候选已删除时不回填相似点位', async () => {
    vi.spyOn(collectApi, 'listPoints').mockResolvedValue(page([point('temp1')]))
    const picker = usePointPicker(true)
    expect(await picker.resolve(match())).toBeNull()
    expect(picker.error.value).toBe('点位已不存在，请重新搜索')
  })

  it.each(['关闭', '重搜'])('%s时取消在途选择，不回填绑定', async (action) => {
    const pending = deferred<Page<CollectPoint>>()
    vi.spyOn(collectApi, 'listPoints')
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValue(page([]))
    const picker = usePointPicker(true)
    const selection = picker.resolve(match())
    expect(picker.selecting.value).toBe(true)
    if (action === '关闭') picker.dispose()
    else await picker.search()
    pending.resolve(page([point('temp')]))
    expect(await selection).toBeNull()
    expect(picker.selecting.value).toBe(false)
    expect(picker.error.value).toBeNull()
  })
})
