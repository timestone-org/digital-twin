/**
 * @fileoverview 契约：推送条目解成 `PointSample` 时，`error` 档只带原因、
 * `stale` 档保留旧值的时刻，形状不对的条目直接丢——**绝不退化成一个 value 是
 * undefined 的 ok**，那与「现场报了空值」长得一模一样。
 * 条目形状的真源是 platform-server 的 `apps/collect/services/point_frames.py`。
 */
import { describe, expect, it } from 'vitest'

import {
  collectTopic,
  dashboardTopic,
  decodePointItem,
  decodePointItems,
} from '@/runtime/pointFrames'

describe('一条条目', () => {
  it('ok 档带值、时刻与质量位', () => {
    const decoded = decodePointItem({
      nodeKey: 's1:t1',
      state: 'ok',
      value: 21.5,
      timestampMs: 1_764_000_000_000,
      quality: 'good',
    })

    expect(decoded).toEqual({
      nodeKey: 's1:t1',
      sample: {
        state: 'ok',
        value: 21.5,
        timestampMs: 1_764_000_000_000,
        quality: 'good',
      },
    })
  })

  it('stale 档的时刻仍是旧值的时刻', () => {
    const decoded = decodePointItem({
      nodeKey: 's1:t1',
      state: 'stale',
      value: 3,
      timestampMs: 1_700_000_000_000,
      quality: 'uncertain',
    })

    expect(decoded?.sample).toEqual({
      state: 'ok',
      value: 3,
      timestampMs: 1_700_000_000_000,
      quality: 'uncertain',
    })
  })

  it('error 档只带原因，没有 value / timestampMs / quality', () => {
    const decoded = decodePointItem({
      nodeKey: 's1:t1',
      state: 'error',
      errorMessage: '点位暂无快照值，采集侧还没上报过它',
    })

    expect(decoded?.sample).toEqual({
      state: 'error',
      errorMessage: '点位暂无快照值，采集侧还没上报过它',
    })
  })

  it('error 档没给原因时补一句，不留白', () => {
    const decoded = decodePointItem({ nodeKey: 's1:t1', state: 'error' })

    expect(decoded?.sample).toEqual({
      state: 'error',
      errorMessage: '点位取不到值',
    })
  })

  it('零与假都是合法读数，不当成没有值', () => {
    const zero = decodePointItem({
      nodeKey: 's1:t1',
      state: 'ok',
      value: 0,
      timestampMs: 1,
      quality: 'good',
    })
    const off = decodePointItem({
      nodeKey: 's1:t2',
      state: 'ok',
      value: false,
      timestampMs: 1,
      quality: 'good',
    })

    expect(zero?.sample).toMatchObject({ state: 'ok', value: 0 })
    expect(off?.sample).toMatchObject({ state: 'ok', value: false })
  })

  it('认不出的质量位按 uncertain，不替现场担保成 good', () => {
    const decoded = decodePointItem({
      nodeKey: 's1:t1',
      state: 'ok',
      value: 1,
      timestampMs: 1,
      quality: 'excellent',
    })

    expect(decoded?.sample).toMatchObject({ quality: 'uncertain' })
  })

  it('缺点位身份、缺时刻、状态认不出来的一律丢掉', () => {
    expect(
      decodePointItem({ state: 'ok', value: 1, timestampMs: 1 }),
    ).toBeNull()
    expect(
      decodePointItem({ nodeKey: '', state: 'ok', timestampMs: 1 }),
    ).toBeNull()
    expect(
      decodePointItem({ nodeKey: 's:1', state: 'ok', value: 1 }),
    ).toBeNull()
    expect(
      decodePointItem({
        nodeKey: 's:1',
        state: 'ok',
        value: 1,
        timestampMs: Number.NaN,
      }),
    ).toBeNull()
    expect(decodePointItem({ nodeKey: 's:1', state: 'weird' })).toBeNull()
    expect(decodePointItem('not an object')).toBeNull()
  })
})

describe('一整帧的载荷', () => {
  it('解出全部合法条目，丢掉不合法的那些', () => {
    const decoded = decodePointItems({
      items: [
        {
          nodeKey: 's:1',
          state: 'ok',
          value: 1,
          timestampMs: 1,
          quality: 'good',
        },
        { state: 'ok', value: 2, timestampMs: 2, quality: 'good' },
        { nodeKey: 's:2', state: 'error', errorMessage: '读不到' },
      ],
    })

    expect(decoded.map((item) => item.nodeKey)).toEqual(['s:1', 's:2'])
  })

  it('载荷不是对象、或没有 items 时给空表', () => {
    expect(decodePointItems(null)).toEqual([])
    expect(decodePointItems({})).toEqual([])
    expect(decodePointItems({ items: 'nope' })).toEqual([])
  })
})

describe('主题', () => {
  const ID = '0198c0f6-1c2f-7a10-9f3d-2c9b6b3a5e41'

  it('一张大屏一个主题，形状是 `dashboard:{id}`', () => {
    expect(dashboardTopic(ID)).toBe(`dashboard:${ID}`)
  })

  it('一个采集数据源一个主题，形状是 `collect:{id}`', () => {
    expect(collectTopic(ID)).toBe(`collect:${ID}`)
  })

  it('⚠ 两个前缀不许撞——写串了 hub 会以「主题未登记」拒订，而页面只表现为「永远没有值」', () => {
    expect(collectTopic(ID)).not.toBe(dashboardTopic(ID))
  })
})
