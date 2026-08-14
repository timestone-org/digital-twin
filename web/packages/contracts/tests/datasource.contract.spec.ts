/**
 * @fileoverview 契约：`PointSample` 能表达 publisher 真推的三档条目
 * （platform-server `services/publish_items.py`）——`ok` / `stale` 带值，
 * `error` 只带原因。
 * ⚠ 少了 `state` 这一档判别，「取不到」与「陈旧」在客户端就只剩「没有值」一种表现，
 * 而 `ModuleStatus` 的 stale / error 正是靠它们区分的。
 */
import { describe, expect, it } from 'vitest'

import { POINT_QUALITIES, POINT_STATES } from '../src/index'
import type {
  PointQuality,
  PointSample,
  PointState,
  PointValueListener,
} from '../src/index'

const POINT_STATE_MEMBERS: Record<PointState, true> = {
  ok: true,
  stale: true,
  error: true,
}
const POINT_QUALITY_MEMBERS: Record<PointQuality, true> = {
  good: true,
  uncertain: true,
  bad: true,
}

describe('读数的取值集合', () => {
  it('三档状态与 publisher 的 POINT_STATES 逐字一致', () => {
    expect([...POINT_STATES]).toEqual(['ok', 'stale', 'error'])
  })

  it('状态的类型成员与运行时常量对齐', () => {
    expect(Object.keys(POINT_STATE_MEMBERS).sort()).toEqual(
      [...POINT_STATES].sort(),
    )
  })

  it('质量位的类型成员与运行时常量对齐', () => {
    expect(Object.keys(POINT_QUALITY_MEMBERS).sort()).toEqual(
      [...POINT_QUALITIES].sort(),
    )
  })
})

describe('一次读数的形状', () => {
  it('ok 档带值、时刻与质量位', () => {
    const sample: PointSample = {
      state: 'ok',
      value: 21.5,
      timestampMs: 1_764_000_000_000,
      quality: 'good',
    }

    expect(Object.keys(sample).sort()).toEqual([
      'quality',
      'state',
      'timestampMs',
      'value',
    ])
  })

  it('stale 档的时刻仍是旧值的时刻，不是当前墙钟', () => {
    const sample: PointSample = {
      state: 'stale',
      value: 21.5,
      timestampMs: 1_764_000_000_000,
      quality: 'good',
    }

    expect(sample.state === 'stale' ? sample.timestampMs : 0).toBe(
      1_764_000_000_000,
    )
  })

  it('error 档只带原因，没有 value / timestampMs / quality', () => {
    const sample: PointSample = {
      state: 'error',
      errorMessage: '点位暂无快照值，采集侧还没上报过它',
    }

    expect(Object.keys(sample).sort()).toEqual(['errorMessage', 'state'])
  })

  it('按 state 判别后三档各自窄化得出来', () => {
    const samples: PointSample[] = [
      { state: 'ok', value: 0, timestampMs: 1, quality: 'good' },
      { state: 'stale', value: false, timestampMs: 2, quality: 'uncertain' },
      { state: 'error', errorMessage: '点位快照暂时读不到' },
    ]

    expect(
      samples.map((sample) =>
        sample.state === 'error' ? sample.errorMessage : sample.value,
      ),
    ).toEqual([0, false, '点位快照暂时读不到'])
  })

  it('监听器收到点位身份与读数两件事', () => {
    const seen: string[] = []
    const listener: PointValueListener = (nodeKey, sample) => {
      seen.push(`${nodeKey}:${sample.state}`)
    }

    listener('src-1:temp', {
      state: 'error',
      errorMessage: '点位快照暂时读不到',
    })

    expect(seen).toEqual(['src-1:temp:error'])
  })
})
