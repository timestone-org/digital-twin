/**
 * @fileoverview 锁住台账趋势取数的两条时序契约：慢的那次后返回不许覆盖新结果，
 * 卸载之后返回的那一次一个字都不许再写。
 *
 * ⚠ 这两条错了都不报错：界面只是显示上一次的曲线，或者在一个已经没人看的
 * 状态上继续写——看着完全正常。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DatasetColumn, DatasetSeries } from '@dt/contracts'

import * as dataset from '@/api/dataset'
import { useDatasetTrend } from '@/features/trend/useDatasetTrend'

function column(key: string): DatasetColumn {
  return {
    id: `id-${key}`,
    table_id: 't1',
    key,
    name: key,
    unit: 'kW',
    decimals: null,
    data_type: 'number',
    source: 'point',
    agg: 'avg',
    node_key: null,
    formula: null,
    formula_deps: null,
    order_index: 0,
    is_required: false,
    default_value: null,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
  }
}

function answer(value: number): DatasetSeries {
  return {
    series: { a: [{ ts: '2026-08-24T00:00:00.000Z', value }] },
    is_truncated: false,
    limit: 5000,
  }
}

/** 一个手动决定何时兑现的 promise。 */
function deferred(): {
  promise: Promise<DatasetSeries>
  settle: (value: DatasetSeries) => void
} {
  let settle: (value: DatasetSeries) => void = () => undefined
  const promise = new Promise<DatasetSeries>((resolve) => {
    settle = resolve
  })
  return { promise, settle }
}

function trend() {
  return useDatasetTrend(
    () => 't1',
    () => [column('a')],
  )
}

beforeEach(() => {
  vi.spyOn(dataset, 'getDatasetSeries')
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('竞态', () => {
  it('⚠ 先发后回的那一次不许覆盖后发先回的结果', async () => {
    const slow = deferred()
    const fast = deferred()
    vi.mocked(dataset.getDatasetSeries)
      .mockReturnValueOnce(slow.promise)
      .mockReturnValueOnce(fast.promise)
    const one = trend()

    const first = one.query()
    const second = one.query()
    fast.settle(answer(2))
    await second
    slow.settle(answer(1))
    await first

    expect(one.series.value[0]?.points).toEqual([
      ['2026-08-24T00:00:00.000Z', 2],
    ])
  })

  it('⚠ 卸载之后返回的那一次不许再写状态', async () => {
    const late = deferred()
    vi.mocked(dataset.getDatasetSeries).mockReturnValueOnce(late.promise)
    const one = trend()

    const flying = one.query()
    one.dispose()
    late.settle(answer(9))
    await flying

    // ok 与 fail 两条分支都没跑：图上什么都没有，也没有冒出一句失败文案
    expect(one.series.value).toEqual([])
    expect(one.failure.value).toBe(null)
  })
})

describe('不该发的请求一律不发', () => {
  it('一条都没勾时不发请求', async () => {
    const one = useDatasetTrend(
      () => 't1',
      () => [],
    )
    await one.query()
    expect(vi.mocked(dataset.getDatasetSeries)).not.toHaveBeenCalled()
  })

  it('自定义范围填不全时不发请求——本地就看得出的错不该占一次往返', async () => {
    const one = trend()
    one.range.value = { preset: 'custom', from: '', to: '' }
    await one.query()
    expect(vi.mocked(dataset.getDatasetSeries)).not.toHaveBeenCalled()
  })
})
