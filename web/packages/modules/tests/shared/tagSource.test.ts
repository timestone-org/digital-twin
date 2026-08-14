/**
 * @fileoverview 守实时读数注入槽的契约：没装源时是空 Map（测试与组件展示照样跑得起来）、
 * 装上之后原样透出，以及 ⚠ 每次读都重新调 getter——缓存一次就等于此后再也不更新。
 */
import type { PointSample } from '@dt/contracts'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  __resetTagSource,
  configureTagSource,
  readTagSnapshots,
  type PointSampleMap,
} from '../../src/shared/tagSource'

const reading: PointSample = {
  state: 'ok',
  value: 42,
  timestampMs: 1_700_000_000_000,
  quality: 'good',
}
const failed: PointSample = { state: 'error', errorMessage: '通道断开' }

afterEach(() => {
  __resetTagSource()
})

describe('实时读数注入槽', () => {
  it('没装源时是空 Map', () => {
    expect(readTagSnapshots().size).toBe(0)
    expect(readTagSnapshots().get('plc:temp')).toBeUndefined()
  })

  it('装上之后按 node_key 原样透出', () => {
    const samples = new Map<string, PointSample>([
      ['plc:temp', reading],
      ['plc:flow', failed],
    ])
    configureTagSource(() => samples)

    expect(readTagSnapshots()).toBe(samples)
    expect(readTagSnapshots().get('plc:temp')).toEqual(reading)
  })

  it('取不到的点位原样带着错因过来，不伪造读数', () => {
    configureTagSource(() => new Map([['plc:flow', failed]]))

    expect(readTagSnapshots().get('plc:flow')).toEqual(failed)
  })

  it('复位之后退回空 Map', () => {
    configureTagSource(() => new Map([['plc:temp', reading]]))
    __resetTagSource()

    expect(readTagSnapshots().size).toBe(0)
  })

  it('每读一次都重新求值，不缓存首次结果', () => {
    const first: PointSampleMap = new Map([['plc:temp', reading]])
    const second: PointSampleMap = new Map([['plc:flow', failed]])
    const getter = vi.fn<() => PointSampleMap>()
    getter.mockReturnValueOnce(first).mockReturnValueOnce(second)
    configureTagSource(getter)

    expect(readTagSnapshots()).toBe(first)
    expect(readTagSnapshots()).toBe(second)
    expect(getter).toHaveBeenCalledTimes(2)
  })
})
