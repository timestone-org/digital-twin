/**
 * @fileoverview 契约：时序槽的取数分派按取数说明**自己的字段**认支路——点位归档
 * 走点位那条批量聚合，台账列走台账那条 `:series`，两支都认不出的说出为什么。
 *
 * ⚠ 按字段而不是按来源串判别：`sourceKind` 到不了这一层。摸错字段拿到的是
 * `undefined`，它会一路流成一次「没配点位」，两条支路于是各画各的空图。
 * ⚠ 这一支这一轮没有要取的就不发请求：空批次问后端换回来的也是空结论，
 * 而它与「这一屏根本没有台账绑定」在网络面板上长得一样。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BindingDetail, SeriesOutcome } from '@dt/contracts'
import { isDataSourceError } from '@dt/datasources'

import type { SeriesFetchOutcome } from '@/api/pointSeries'

vi.mock('@/api/pointSeries', () => ({ readPointSeries: vi.fn() }))
vi.mock('@/api/datasetSeries', () => ({ readDatasetSeries: vi.fn() }))

const { readPointSeries } = await import('@/api/pointSeries')
const { readDatasetSeries } = await import('@/api/datasetSeries')
const { fetchDatasetSeries, readDashboardSeries } =
  await import('@/runtime/seriesReader')

const ARCHIVE: BindingDetail = {
  nodeKey: 's-1:温度',
  range: { lastWindow: '1h' },
}

const DATASET: BindingDetail = {
  datasetKey: 'ds:能耗:电量',
  range: { lastWindow: '7d' },
}

/** 既没有点位身份也没有台账列身份的一条说明；线上真会存下这种。 */
const BROKEN = { range: { lastWindow: '1h' } } as unknown as BindingDetail

/**
 * 一条取到了的结论。
 * @param points 这条序列的点
 * @param isTruncated 窗内还有更多点没取回来
 */
function ok(
  points: readonly { t: number; v: unknown }[],
  isTruncated = false,
): SeriesFetchOutcome {
  return { state: 'ok', points, isTruncated, isStale: false }
}

/** 把一批结论摆成适配器该回的那张表。 */
function table(
  entries: readonly [string, SeriesFetchOutcome][],
): ReadonlyMap<string, SeriesFetchOutcome> {
  return new Map(entries)
}

const EMPTY: ReadonlyMap<string, SeriesFetchOutcome> = new Map()

beforeEach(() => {
  vi.mocked(readPointSeries).mockReset()
  vi.mocked(readDatasetSeries).mockReset()
  vi.mocked(readPointSeries).mockResolvedValue(EMPTY)
  vi.mocked(readDatasetSeries).mockResolvedValue(EMPTY)
})

describe('来源分派', () => {
  it('带点位身份的走点位那条批量聚合', async () => {
    vi.mocked(readPointSeries).mockResolvedValue(
      table([['seriesValues[0].series', ok([{ t: 1, v: 2 }])]]),
    )
    const signal = new AbortController().signal

    const found = await readDashboardSeries(
      [{ fieldKey: 'seriesValues[0].series', detail: ARCHIVE }],
      signal,
    )

    expect(readPointSeries).toHaveBeenCalledWith(
      [{ fieldKey: 'seriesValues[0].series', detail: ARCHIVE }],
      signal,
    )
    expect(readDatasetSeries).not.toHaveBeenCalled()
    expect(found.get('seriesValues[0].series')).toEqual(ok([{ t: 1, v: 2 }]))
  })

  it('带台账列身份的走台账那条 :series', async () => {
    vi.mocked(readDatasetSeries).mockResolvedValue(
      table([['dayValues[0].series', ok([{ t: 9, v: 8 }])]]),
    )
    const signal = new AbortController().signal

    const found = await readDashboardSeries(
      [{ fieldKey: 'dayValues[0].series', detail: DATASET }],
      signal,
    )

    expect(readDatasetSeries).toHaveBeenCalledWith(
      [{ fieldKey: 'dayValues[0].series', detail: DATASET }],
      signal,
    )
    expect(readPointSeries).not.toHaveBeenCalled()
    expect(found.get('dayValues[0].series')).toEqual(ok([{ t: 9, v: 8 }]))
  })

  it('两支混在一批里各发各的，结论并成一张表', async () => {
    vi.mocked(readPointSeries).mockResolvedValue(
      table([['a', ok([{ t: 1, v: 1 }])]]),
    )
    vi.mocked(readDatasetSeries).mockResolvedValue(
      table([['b', ok([{ t: 2, v: 2 }])]]),
    )

    const found = await readDashboardSeries(
      [
        { fieldKey: 'a', detail: ARCHIVE },
        { fieldKey: 'b', detail: DATASET },
      ],
      new AbortController().signal,
    )

    expect(vi.mocked(readPointSeries).mock.calls[0]?.[0]).toEqual([
      { fieldKey: 'a', detail: ARCHIVE },
    ])
    expect(vi.mocked(readDatasetSeries).mock.calls[0]?.[0]).toEqual([
      { fieldKey: 'b', detail: DATASET },
    ])
    expect([...found.keys()].sort()).toEqual(['a', 'b'])
  })

  // ⚠ 认不出的落 error 而不是当成台账：当成台账去问，换回来的是一句
  // 「不是台账列身份」，而真正的毛病是这条绑定两支字段都没有
  it('两支都认不出的当场落 error，且一次请求都不发', async () => {
    const found = await readDashboardSeries(
      [{ fieldKey: 'x', detail: BROKEN }],
      new AbortController().signal,
    )

    const outcome: SeriesOutcome | undefined = found.get('x')
    expect(outcome?.state).toBe('error')
    expect(outcome).toMatchObject({
      message: expect.stringContaining('认不出'),
    })
    expect(readPointSeries).not.toHaveBeenCalled()
    expect(readDatasetSeries).not.toHaveBeenCalled()
  })

  // ⚠ 两个身份字段都在、但值是 null：绑定面里挑了来源又没挑东西就会存成这样
  it('身份字段在而值不是串的，同样认不出', async () => {
    const blank = {
      nodeKey: null,
      datasetKey: null,
      range: {},
    } as unknown as BindingDetail

    const found = await readDashboardSeries(
      [{ fieldKey: 'x', detail: blank }],
      new AbortController().signal,
    )

    expect(found.get('x')?.state).toBe('error')
    expect(readPointSeries).not.toHaveBeenCalled()
    expect(readDatasetSeries).not.toHaveBeenCalled()
  })

  it('一批全空时两支都不问', async () => {
    const found = await readDashboardSeries([], new AbortController().signal)

    expect(found.size).toBe(0)
    expect(readPointSeries).not.toHaveBeenCalled()
    expect(readDatasetSeries).not.toHaveBeenCalled()
  })
})

describe('台账 provider 的单条口', () => {
  it('折成一批一条，取到了就翻成历史读侧的结果', async () => {
    vi.mocked(readDatasetSeries).mockResolvedValue(
      table([['one', ok([{ t: 3, v: 4 }], true)]]),
    )

    const found = await fetchDatasetSeries({
      nodeKey: 'ds:能耗:电量',
      range: { lastWindow: '1d' },
    })

    expect(vi.mocked(readDatasetSeries).mock.calls[0]?.[0]).toEqual([
      {
        fieldKey: 'one',
        detail: { datasetKey: 'ds:能耗:电量', range: { lastWindow: '1d' } },
      },
    ])
    expect(found).toEqual({
      points: [{ t: 3, v: 4 }],
      isTruncated: true,
      isStale: false,
    })
  })

  // ⚠ 取不到必须抛：回一条空 points 会被读成「这段时间确实没数据」
  it('取不到就抛，且把原因原样带上', async () => {
    vi.mocked(readDatasetSeries).mockResolvedValue(
      table([['one', { state: 'error', message: '找不到台账编码 能耗' }]]),
    )

    const failure = await fetchDatasetSeries({
      nodeKey: 'ds:能耗:电量',
      range: {},
    }).catch((caught: unknown) => caught)

    expect(isDataSourceError(failure)).toBe(true)
    expect(String(failure)).toContain('找不到台账编码 能耗')
  })

  it('这一批压根没回这一条也算取不到', async () => {
    vi.mocked(readDatasetSeries).mockResolvedValue(EMPTY)

    const failure = await fetchDatasetSeries({
      nodeKey: 'ds:能耗:电量',
      range: {},
    }).catch((caught: unknown) => caught)

    expect(isDataSourceError(failure)).toBe(true)
    expect(String(failure)).toContain('没有回这一条')
  })
})
