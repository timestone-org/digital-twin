/**
 * @fileoverview 守时序槽取数驱动器的四条竞态纪律：键一变就作废在飞的那一次、
 * 晚到的结果不许写回、写槽不会再驱动一次（不自激）、作用域销毁时全量作废；
 * 外加「没装取数口就一条槽都不接管」与「取不到落 error 而不是空序列」。
 */
import type {
  BindingPayload,
  BindingSpec,
  SeriesOutcome,
  SeriesReader,
  SeriesRequest,
} from '@dt/contracts'
import { flushPromises } from '@vue/test-utils'
import { effectScope, nextTick, ref, type EffectScope } from 'vue'
import { describe, expect, it } from 'vitest'

import type { BindingSlot } from '../src/moduleValues'
import { fakeBinding } from '../src/testing/fixtures'
import { useSeriesSlots } from '../src/useSeriesSlots'

type Outcomes = ReadonlyMap<string, SeriesOutcome>

/** 一个数组槽：行内一条时序子槽。 */
const SPECS: readonly BindingSpec[] = [
  {
    key: 'seriesValues',
    label: '系列',
    dataType: 'number',
    isArray: true,
    isEntityPinned: true,
    arrayFields: [
      { key: 'series', label: '曲线', dataType: 'number', isTimeSeries: true },
    ],
  },
]

const SLOT_KEY = 'seriesValues[0].series'

function seriesBinding(lastWindow: string): BindingPayload {
  return fakeBinding({
    id: `b-${lastWindow}`,
    fieldKey: SLOT_KEY,
    sourceKind: 'archive',
    detailJson: { nodeKey: 'src:p0', range: { lastWindow } },
  })
}

function okOutcomes(value: number): Outcomes {
  return new Map([
    [
      SLOT_KEY,
      {
        state: 'ok',
        points: [{ t: 1, v: value }],
        isTruncated: false,
        isStale: false,
      },
    ],
  ])
}

/** 一次没落地的取数：用例自己决定它什么时候、以什么结果落地。 */
interface Pending {
  requests: readonly SeriesRequest[]
  signal: AbortSignal
  settle: (outcomes: Outcomes) => void
  fail: (reason: unknown) => void
}

/** 把每次调用记下来并挂着不落地。 */
function recordingReader(calls: Pending[]): SeriesReader {
  return (requests, signal) =>
    new Promise<Outcomes>((resolve, reject) => {
      calls.push({ requests, signal, settle: resolve, fail: reject })
    })
}

function runInScope<T>(scope: EffectScope, factory: () => T): T {
  const value = scope.run(factory)
  if (value === undefined) throw new Error('作用域没跑起来')
  return value
}

interface Harness {
  scope: EffectScope
  calls: Pending[]
  slots: { value: ReadonlyMap<string, BindingSlot> }
  bindings: { value: readonly BindingPayload[] }
  epoch: { value: number }
}

/**
 * 装一格驱动器，绑定与节拍都可以在用例里改。
 * @param options 初始绑定；`wired` 为假时不装批量取数口
 */
function harness(options?: {
  bindings?: readonly BindingPayload[]
  wired?: boolean
}): Harness {
  const calls: Pending[] = []
  const bindings = ref<readonly BindingPayload[]>(
    options?.bindings ?? [seriesBinding('1h')],
  )
  const epoch = ref(0)
  const reader = options?.wired === false ? undefined : recordingReader(calls)
  const scope = effectScope()
  const slots = runInScope(scope, () =>
    useSeriesSlots({
      specs: () => SPECS,
      bindings: () => bindings.value,
      read: () => reader,
      epoch: () => epoch.value,
    }),
  )
  return { scope, calls, slots, bindings, epoch }
}

describe('发起一轮取数', () => {
  it('一次收一批：全部时序槽并成同一次请求', () => {
    const first = seriesBinding('1h')
    const second = fakeBinding({
      id: 'b-2',
      fieldKey: 'seriesValues[1].series',
      sourceKind: 'archive',
      detailJson: { nodeKey: 'src:p1', range: { lastWindow: '1h' } },
    })
    const { calls, scope } = harness({ bindings: [first, second] })

    expect(calls).toHaveLength(1)
    expect(calls[0]?.requests.map((request) => request.fieldKey)).toEqual([
      SLOT_KEY,
      'seriesValues[1].series',
    ])
    scope.stop()
  })

  it('首帧到之前是等首帧，不是空图', () => {
    const { slots, scope } = harness()

    expect(slots.value.get(SLOT_KEY)).toEqual({ state: 'pending' })
    scope.stop()
  })

  it('取回来的序列按槽键落到槽表上', async () => {
    const { calls, slots, scope } = harness()

    calls[0]?.settle(okOutcomes(7))
    await flushPromises()

    expect(slots.value.get(SLOT_KEY)).toMatchObject({ state: 'ok', value: 7 })
    scope.stop()
  })

  it('没装批量取数口时一条槽都不接管', () => {
    const { calls, slots, scope } = harness({ wired: false })

    expect(calls).toHaveLength(0)
    expect(slots.value.size).toBe(0)
    scope.stop()
  })

  it('时序槽没有取数说明时不发请求，就地落 error', () => {
    const bare = fakeBinding({
      id: 'b-bare',
      fieldKey: SLOT_KEY,
      sourceKind: 'opcua',
      nodeKey: 'src:p0',
    })
    const { calls, slots, scope } = harness({ bindings: [bare] })

    expect(calls).toHaveLength(0)
    expect(slots.value.get(SLOT_KEY)).toEqual({
      state: 'error',
      message: '这一档来源给不出历史序列',
    })
    scope.stop()
  })
})

describe('竞态防护', () => {
  it('键一变就作废在飞的那一次', async () => {
    const { calls, bindings, scope } = harness()

    bindings.value = [seriesBinding('24h')]
    await nextTick()

    expect(calls[0]?.signal.aborted).toBe(true)
    expect(calls).toHaveLength(2)
    expect(calls[1]?.signal.aborted).toBe(false)
    scope.stop()
  })

  it('作废了的那一次即使拿到了结果也不许写回', async () => {
    const { calls, slots, bindings, scope } = harness()

    bindings.value = [seriesBinding('24h')]
    await nextTick()
    calls[0]?.settle(okOutcomes(1))
    await flushPromises()

    expect(slots.value.get(SLOT_KEY)).toEqual({ state: 'pending' })

    calls[1]?.settle(okOutcomes(2))
    await flushPromises()

    expect(slots.value.get(SLOT_KEY)).toMatchObject({ value: 2 })
    scope.stop()
  })

  it('作废了的那一次失败了也不许写回', async () => {
    const { calls, slots, bindings, scope } = harness()

    bindings.value = [seriesBinding('24h')]
    await nextTick()
    calls[0]?.fail(new Error('早就不要了'))
    await flushPromises()

    expect(slots.value.get(SLOT_KEY)).toEqual({ state: 'pending' })
    scope.stop()
  })

  it('写槽不会再驱动一次取数', async () => {
    const { calls, slots, scope } = harness()

    calls[0]?.settle(okOutcomes(7))
    await flushPromises()
    await nextTick()

    expect(slots.value.get(SLOT_KEY)).toMatchObject({ state: 'ok' })
    expect(calls).toHaveLength(1)
    scope.stop()
  })

  it('作用域销毁时把在飞的那一次全量作废', () => {
    const { calls, scope } = harness()

    scope.stop()

    expect(calls[0]?.signal.aborted).toBe(true)
  })

  it('销毁之后回来的结果不写槽表', async () => {
    const { calls, slots, scope } = harness()

    scope.stop()
    calls[0]?.settle(okOutcomes(9))
    await flushPromises()

    expect(slots.value.get(SLOT_KEY)).toEqual({ state: 'pending' })
  })
})

describe('刷新节拍', () => {
  it('节拍一跳就重取一轮', async () => {
    const { calls, epoch, scope } = harness()

    calls[0]?.settle(okOutcomes(1))
    await flushPromises()
    epoch.value += 1
    await nextTick()

    expect(calls).toHaveLength(2)
    scope.stop()
  })

  it('重取期间沿用上一轮的曲线，不打回等首帧', async () => {
    const { calls, slots, epoch, scope } = harness()

    calls[0]?.settle(okOutcomes(1))
    await flushPromises()
    epoch.value += 1
    await nextTick()

    expect(slots.value.get(SLOT_KEY)).toMatchObject({ state: 'ok', value: 1 })
    scope.stop()
  })

  it('换了取数说明时不沿用，避免短暂画出上一条绑定的曲线', async () => {
    const { calls, slots, bindings, scope } = harness()

    calls[0]?.settle(okOutcomes(1))
    await flushPromises()
    bindings.value = [seriesBinding('24h')]
    await nextTick()

    expect(slots.value.get(SLOT_KEY)).toEqual({ state: 'pending' })
    scope.stop()
  })
})

describe('取不到的时候', () => {
  it('整批失败时每一条都落 error 而不是空序列', async () => {
    const { calls, slots, scope } = harness()

    calls[0]?.fail(new Error('端点 503'))
    await flushPromises()

    expect(slots.value.get(SLOT_KEY)).toEqual({
      state: 'error',
      message: '端点 503',
    })
    scope.stop()
  })

  it('回表里少了这一条也算取不到', async () => {
    const { calls, slots, scope } = harness()

    calls[0]?.settle(new Map())
    await flushPromises()

    expect(slots.value.get(SLOT_KEY)).toEqual({
      state: 'error',
      message: '取数没有回这一条',
    })
    scope.stop()
  })
})
