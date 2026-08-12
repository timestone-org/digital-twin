/**
 * @fileoverview 锁住折线图取值契约：`null` 是断档不是 0，分组按首次出现定序。
 */
import { describe, expect, it } from 'vitest'

import {
  axisGroups,
  toChartData,
  unitOfAxis,
} from '../../../src/shared/chart/series'
import type { DtChartSeries } from '../../../src/shared/chart/series'

function series(key: string, axis: string, unit: string): DtChartSeries {
  return { key, name: key.toUpperCase(), unit, axis, points: [] }
}

describe('toChartData', () => {
  it('RFC3339 时刻换成毫秒时间戳', () => {
    expect(toChartData([['2026-08-12T02:55:00.000Z', 21.5]])).toEqual([
      [Date.UTC(2026, 7, 12, 2, 55), 21.5],
    ])
  })

  it('null 原样保留，不折成 0', () => {
    expect(toChartData([['2026-08-12T02:55:00.000Z', null]])).toEqual([
      [Date.UTC(2026, 7, 12, 2, 55), null],
    ])
  })

  it('解析不出时刻的点被丢掉', () => {
    expect(
      toChartData([
        ['坏时刻', 1],
        ['2026-08-12T02:56:00.000Z', 2],
      ]),
    ).toEqual([[Date.UTC(2026, 7, 12, 2, 56), 2]])
  })

  it('空序列给空数组', () => {
    expect(toChartData([])).toEqual([])
  })
})

describe('axisGroups', () => {
  it('按首次出现去重定序', () => {
    expect(
      axisGroups([
        series('a', 'humidity', '%'),
        series('b', 'temperature', '℃'),
        series('c', 'humidity', '%'),
      ]),
    ).toEqual(['humidity', 'temperature'])
  })

  it('没有系列时没有分组', () => {
    expect(axisGroups([])).toEqual([])
  })
})

describe('unitOfAxis', () => {
  it('取该组第一条系列的量纲', () => {
    const all = [
      series('a', 'temperature', '℃'),
      series('b', 'temperature', 'K'),
    ]
    expect(unitOfAxis(all, 'temperature')).toBe('℃')
  })

  it('组里一条系列都没有时给空串', () => {
    expect(unitOfAxis([], 'temperature')).toBe('')
  })
})
