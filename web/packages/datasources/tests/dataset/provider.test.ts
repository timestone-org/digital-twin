/**
 * @fileoverview 契约：台账 provider 走注入的取数函数，订阅一律拒绝（台账没有
 * 可推的现值），失败一律拒绝并说明原因，绝不返回空 `points` 冒充「这段时间没
 * 数据」；身份串形状不对时就地说破，不拿去问后端再收一个「没这张台账」。
 */
import type { HistoryQuery, HistoryResult } from '@dt/contracts'
import { describe, expect, it, vi } from 'vitest'

import { DataSourceError } from '../../src/errors'
import { createDatasetProvider } from '../../src/dataset/provider'

const RESULT: HistoryResult = {
  points: [
    { t: 1_764_000_000_000, v: 12.5 },
    { t: 1_764_003_600_000, v: 13.1 },
  ],
  isTruncated: true,
  isStale: false,
}

const KEY = 'ds:energy_log:进水量'

function query(range: HistoryQuery['range'] = {}): HistoryQuery {
  return { nodeKey: KEY, range }
}

function provider(
  fetchSeries: (q: HistoryQuery) => Promise<HistoryResult> = () =>
    Promise.resolve(RESULT),
) {
  return createDatasetProvider({ fetchSeries })
}

describe('台账序列 provider', () => {
  it('认 dataset 这一种来源', () => {
    expect(provider().kind).toBe('dataset')
  })

  it('取到的结果原样往上给，包括触顶与陈旧两个标记', async () => {
    // ⚠ 触顶留的是**最新**那批，不上报的话曲线开头凭空少一截会被读成采集坏了
    await expect(provider().readHistory(query())).resolves.toEqual(RESULT)
  })

  it('把取数条件原样交给注入的函数', async () => {
    const fetchSeries = vi.fn().mockResolvedValue(RESULT)

    await provider(fetchSeries).readHistory(query({ lastWindow: '24h' }))

    expect(fetchSeries).toHaveBeenCalledWith({
      nodeKey: KEY,
      range: { lastWindow: '24h' },
    })
  })
})

describe('台账没有可订阅的现值', () => {
  it('给了点位就是这条绑定接错了来源，当场抛', () => {
    // ⚠ 台账的行是采集器按周期写出来的，不是一条推流。这里前端自己起轮询
    // 会是假的推送：既复制了后端已有的脏信号，又按「每个看大屏的人一份」放大
    expect(() => provider().subscribe([KEY], () => undefined)).toThrow(
      DataSourceError,
    )
  })

  it('一个点位都没给时给一个空退订，不抛', () => {
    expect(() => provider().subscribe([], () => undefined)).not.toThrow()
  })
})

describe('说不清的取数条件当场说破', () => {
  it.each(['energy_log:进水量', 'ds:energy_log', 'ds:energy_log:a:b', ''])(
    '不是台账列身份的 %s 直接拒绝',
    async (nodeKey) => {
      // 拿它去问后端只会收到一句「没这张台账」，说不出「这串压根不是这个写法」
      await expect(
        provider().readHistory({ nodeKey, range: {} }),
      ).rejects.toThrow(DataSourceError)
    },
  )

  it('左右颠倒的时间窗直接拒绝，不去换一段空序列回来', async () => {
    await expect(
      provider().readHistory(query({ fromMs: 2, toMs: 1 })),
    ).rejects.toThrow(DataSourceError)
  })

  it.each([0, -1, 1.5])('limit 是 %s 时直接拒绝', async (limit) => {
    await expect(provider().readHistory(query({ limit }))).rejects.toThrow(
      DataSourceError,
    )
  })
})

describe('取数失败一律拒绝', () => {
  it('注入的函数抛什么，都包成说得出原因的取数错误', async () => {
    const failing = provider(() => Promise.reject(new Error('库挂了')))

    await expect(failing.readHistory(query())).rejects.toThrow(/库挂了/)
  })

  it('已经是取数错误的原样抛，不再包一层', async () => {
    const inner = new DataSourceError('fetch-failed', '上游说不行')
    const failing = provider(() => Promise.reject(inner))

    await expect(failing.readHistory(query())).rejects.toBe(inner)
  })
})
