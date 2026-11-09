/**
 * @fileoverview 点位那一面的「图已过期」判定：勾选变了要提示，查询条件变了也要提示。
 * ⚠ 只看勾选的话，把平均值换成最大值之后图上还是平均值那几条，且一句提示都没有。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useRacedFetch } from '@/composables/useRacedFetch'
import { defaultTrendRange } from '@/features/trend/trendRange'
import * as data from '@/pages/Trend/scripts/pointTrendData'
import {
  createPointState,
  pointDirty,
  runPointQuery,
  type PointQueryChoice,
} from '@/pages/Trend/scripts/pointTrendState'

afterEach(() => {
  vi.restoreAllMocks()
})

function choice(over: Partial<PointQueryChoice> = {}): PointQueryChoice {
  return {
    range: defaultTrendRange(),
    aggregate: 'avg',
    interval: 'auto',
    ...over,
  }
}

async function queried(first: PointQueryChoice) {
  vi.spyOn(data, 'readPointReadings').mockResolvedValue({
    readings: [{ key: 'k1', points: [] }],
    bucket: { value: '15m', ms: 900_000, label: '15 分钟' },
    isTruncated: false,
  })
  const state = createPointState()
  state.chosen.value = [
    { key: 'k1', label: '车间温度', unit: '℃', isDrawable: true, holdMs: 0 },
  ]
  await runPointQuery(state, useRacedFetch(), first)
  return state
}

describe('查询条件变了也算过期', () => {
  it('刚查完不提示', async () => {
    const state = await queried(choice())
    expect(pointDirty(state, ['k1'], choice())).toBe(false)
  })

  it('⚠ 换了折算档位就提示，再查一次就消掉', async () => {
    const state = await queried(choice())
    const next = choice({ aggregate: 'max' })
    expect(pointDirty(state, ['k1'], next)).toBe(true)
    await runPointQuery(state, useRacedFetch(), next)
    expect(pointDirty(state, ['k1'], next)).toBe(false)
  })

  it('换了时间范围或取点间隔也提示', async () => {
    const state = await queried(choice())
    const range = { ...defaultTrendRange(), preset: 'custom' }
    expect(pointDirty(state, ['k1'], choice({ range }))).toBe(true)
    expect(pointDirty(state, ['k1'], choice({ interval: '1h' }))).toBe(true)
  })

  it('没查过时不提示', () => {
    expect(pointDirty(createPointState(), ['k1'], choice())).toBe(false)
  })
})
