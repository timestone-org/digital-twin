/**
 * @fileoverview 守时序槽取数的纯逻辑：只按清单的时序声明 + 绑定上有没有取数说明
 * 挑槽（一个来源种类都不认），去重键含节拍而取数身份不含，取不到一律落 error
 * 而不是空序列，取到了但窗内 0 点是 ok + 空数组 + 空标量。
 */
import type { BindingSpec, HistoryPoint, SeriesOutcome } from '@dt/contracts'
import { describe, expect, it } from 'vitest'

import {
  PENDING_SLOT,
  detailKeyOf,
  openingSlots,
  planSeries,
  readErrorMessage,
  slotOfOutcome,
  slotKeyOf,
  slotsOfFailure,
  slotsOfOutcomes,
  type SeriesPlan,
} from '../src/seriesSlots'
import { fakeBinding } from '../src/testing/fixtures'

/** 一个数组槽：行内一条时序子槽 + 一条普通标量子槽。 */
const SPECS: readonly BindingSpec[] = [
  {
    key: 'seriesValues',
    label: '系列',
    dataType: 'number',
    isArray: true,
    isEntityPinned: true,
    arrayFields: [
      { key: 'series', label: '曲线', dataType: 'number', isTimeSeries: true },
      { key: 'latest', label: '末值', dataType: 'number' },
    ],
  },
  { key: 'power', label: '功率', dataType: 'number' },
]

/** 带取数说明的一条时序绑定。 */
function seriesBinding(index: number, lastWindow: string) {
  return fakeBinding({
    id: `b-${index}`,
    fieldKey: `seriesValues[${index}].series`,
    sourceKind: 'archive',
    detailJson: { nodeKey: `src:p${index}`, range: { lastWindow } },
  })
}

/** 没有取数说明的一条时序绑定——实时点位、常量、派生都长这样。 */
function bareSeriesBinding(index: number) {
  return fakeBinding({
    id: `bare-${index}`,
    fieldKey: `seriesValues[${index}].series`,
    sourceKind: 'opcua',
    nodeKey: `src:p${index}`,
  })
}

function planOf(
  bindings: readonly ReturnType<typeof seriesBinding>[],
  epoch = 0,
): SeriesPlan {
  return planSeries({ specs: SPECS, bindings, epoch })
}

const OK_POINTS: readonly HistoryPoint[] = [
  { t: 1, v: 10 },
  { t: 2, v: 20 },
]

const OK_OUTCOME: SeriesOutcome = {
  state: 'ok',
  points: OK_POINTS,
  isTruncated: false,
  isStale: false,
}

describe('排取数计划', () => {
  it('只挑清单声明为时序的那些槽', () => {
    const plan = planOf([
      seriesBinding(0, '1h'),
      fakeBinding({
        id: 'b-latest',
        fieldKey: 'seriesValues[0].latest',
        sourceKind: 'archive',
        detailJson: { nodeKey: 'src:p0', range: { lastWindow: '1h' } },
      }),
      fakeBinding({
        id: 'b-power',
        fieldKey: 'power',
        sourceKind: 'archive',
        detailJson: { nodeKey: 'src:p9', range: { lastWindow: '1h' } },
      }),
    ])

    expect(plan.requests.map((request) => request.fieldKey)).toEqual([
      'seriesValues[0].series',
    ])
  })

  it('清单里根本没有的槽键不进计划', () => {
    const plan = planOf([
      fakeBinding({
        id: 'b-ghost',
        fieldKey: 'ghostValues[0].series',
        sourceKind: 'archive',
        detailJson: { nodeKey: 'src:p0', range: { lastWindow: '1h' } },
      }),
    ])

    expect(plan.requests).toEqual([])
    expect(plan.resolved.size).toBe(0)
  })

  it('时序槽没有取数说明就地落 error，不发请求也不给空序列', () => {
    const plan = planOf([bareSeriesBinding(0)])

    expect(plan.requests).toEqual([])
    expect(plan.resolved.get('seriesValues[0].series')).toEqual({
      state: 'error',
      message: '这一档来源给不出历史序列',
    })
  })

  it('请求带的是取数说明原文，槽键原样对号', () => {
    const plan = planOf([seriesBinding(2, '24h')])

    expect(plan.requests).toEqual([
      {
        fieldKey: 'seriesValues[2].series',
        detail: { nodeKey: 'src:p2', range: { lastWindow: '24h' } },
      },
    ])
  })
})

describe('去重键', () => {
  it('节拍一跳签名就变', () => {
    const first = planOf([seriesBinding(0, '1h')], 1)
    const second = planOf([seriesBinding(0, '1h')], 2)

    expect(second.signature).not.toBe(first.signature)
  })

  it('取数身份不含节拍，跨节拍认得出还是同一条绑定', () => {
    const binding = seriesBinding(0, '1h')

    expect(slotKeyOf(binding, 1)).not.toBe(slotKeyOf(binding, 2))
    expect(planOf([binding], 1).detailKeys.get(binding.fieldKey)).toBe(
      planOf([binding], 2).detailKeys.get(binding.fieldKey),
    )
  })

  it('换了窗口就是换了一次取数', () => {
    expect(planOf([seriesBinding(0, '1h')]).signature).not.toBe(
      planOf([seriesBinding(0, '24h')]).signature,
    )
  })

  it('取数说明的键序不影响身份', () => {
    const ordered = fakeBinding({
      id: 'b-a',
      fieldKey: 'seriesValues[0].series',
      sourceKind: 'archive',
      detailJson: { nodeKey: 'src:p0', range: { lastWindow: '1h', limit: 5 } },
    })
    const shuffled = fakeBinding({
      id: 'b-b',
      fieldKey: 'seriesValues[0].series',
      sourceKind: 'archive',
      detailJson: { range: { limit: 5, lastWindow: '1h' }, nodeKey: 'src:p0' },
    })

    expect(detailKeyOf(shuffled)).toBe(detailKeyOf(ordered))
  })

  it('没有取数说明时身份里是一段空说明，与任何真说明都不同形', () => {
    expect(detailKeyOf(bareSeriesBinding(0))).not.toBe(
      detailKeyOf(seriesBinding(0, '1h')),
    )
  })

  it('没有取数说明的槽也进签名，加一条时签名跟着变', () => {
    expect(
      planOf([bareSeriesBinding(0), bareSeriesBinding(1)]).signature,
    ).not.toBe(planOf([bareSeriesBinding(0)]).signature)
  })

  it('一条时序槽都没有时签名是空的', () => {
    expect(planOf([]).signature).toBe('')
  })
})

describe('取数结论折成绑定槽', () => {
  it('取到了就带上序列与末值，且不写采样时刻', () => {
    expect(slotOfOutcome(OK_OUTCOME)).toEqual({
      state: 'ok',
      value: 20,
      points: OK_POINTS,
      isTruncated: false,
      isStale: false,
    })
  })

  it('窗内确实没数据是 ok + 空数组 + 空标量', () => {
    expect(
      slotOfOutcome({
        state: 'ok',
        points: [],
        isTruncated: false,
        isStale: false,
      }),
    ).toEqual({
      state: 'ok',
      value: null,
      points: [],
      isTruncated: false,
      isStale: false,
    })
  })

  it('触顶与降级两个标记原样带上来', () => {
    const slot = slotOfOutcome({
      state: 'ok',
      points: [{ t: 1, v: 1 }],
      isTruncated: true,
      truncatedSide: 'early',
      isStale: true,
    })

    expect(slot).toMatchObject({ isTruncated: true, isStale: true })
  })

  it('取不到就说取不到', () => {
    expect(slotOfOutcome({ state: 'error', message: '端点 500' })).toEqual({
      state: 'error',
      message: '端点 500',
    })
  })
})

describe('把一批结论摊回槽表', () => {
  it('回来的那些按槽键对号入座', () => {
    const plan = planOf([seriesBinding(0, '1h')])
    const slots = slotsOfOutcomes(
      plan,
      new Map([['seriesValues[0].series', OK_OUTCOME]]),
    )

    expect(slots.get('seriesValues[0].series')).toMatchObject({ state: 'ok' })
  })

  it('请求发了却没回这一条，落 error 而不是留空', () => {
    const plan = planOf([seriesBinding(0, '1h')])
    const slots = slotsOfOutcomes(plan, new Map())

    expect(slots.get('seriesValues[0].series')).toEqual({
      state: 'error',
      message: '取数没有回这一条',
    })
  })

  it('给不出序列的那些槽照样摆在表里', () => {
    const plan = planOf([seriesBinding(0, '1h'), bareSeriesBinding(1)])
    const slots = slotsOfOutcomes(plan, new Map())

    expect(slots.get('seriesValues[1].series')).toEqual({
      state: 'error',
      message: '这一档来源给不出历史序列',
    })
  })

  it('整批失败时每一条都带上同一句原因', () => {
    const plan = planOf([seriesBinding(0, '1h'), seriesBinding(1, '1h')])
    const slots = slotsOfFailure(plan, '网断了')

    expect([...slots.values()]).toEqual([
      { state: 'error', message: '网断了' },
      { state: 'error', message: '网断了' },
    ])
  })
})

describe('开跑时先摆上的槽', () => {
  it('取数身份没变就沿用上一轮的结果，不打回等首帧', () => {
    const plan = planOf([seriesBinding(0, '1h')], 2)
    const previous = new Map([
      ['seriesValues[0].series', slotOfOutcome(OK_OUTCOME)],
    ])
    const carried = planOf([seriesBinding(0, '1h')], 1).detailKeys

    expect(
      openingSlots(plan, previous, carried).get('seriesValues[0].series'),
    ).toMatchObject({ state: 'ok' })
  })

  it('换了取数说明就回到等首帧，不许短暂画出上一条绑定的曲线', () => {
    const plan = planOf([seriesBinding(0, '24h')], 2)
    const previous = new Map([
      ['seriesValues[0].series', slotOfOutcome(OK_OUTCOME)],
    ])
    const carried = planOf([seriesBinding(0, '1h')], 1).detailKeys

    expect(
      openingSlots(plan, previous, carried).get('seriesValues[0].series'),
    ).toBe(PENDING_SLOT)
  })

  it('第一轮没有可沿用的结果，一律等首帧', () => {
    const plan = planOf([seriesBinding(0, '1h')])

    expect(
      openingSlots(plan, new Map(), new Map()).get('seriesValues[0].series'),
    ).toBe(PENDING_SLOT)
  })
})

describe('异常里那句话', () => {
  it('异常带消息就用它', () => {
    expect(readErrorMessage(new Error('端点 503'))).toBe('端点 503')
  })

  it('消息是空串的异常也要说得出一句话', () => {
    expect(readErrorMessage(new Error(''))).toBe('取数失败')
  })

  it('抛的是一个串就用那个串', () => {
    expect(readErrorMessage('超时')).toBe('超时')
  })

  it('抛的是别的东西时给一句兜底', () => {
    expect(readErrorMessage({ code: 500 })).toBe('取数失败')
  })
})
