/**
 * @fileoverview 锁住 option 组装：`axis` 分组各占一条 Y 轴、断档不连线、
 * 配色只来自 token（取不到就整个不给，让 echarts 用自己的调色板）。
 */
import { afterEach, describe, expect, it } from 'vitest'

import { buildLineOption } from '../../../src/shared/chart/lineOption'
import type {
  DtChartPoint,
  DtChartSeries,
} from '../../../src/shared/chart/series'

const AT = '2026-08-12T02:55:00.000Z'
const PALETTE_TOKENS = [
  '--accent-primary',
  '--state-success',
  '--state-warning',
  '--state-danger',
  '--accent-secondary',
  '--state-idle',
] as const

function series(
  key: string,
  axis: string,
  unit: string,
  points: readonly DtChartPoint[] = [[AT, 1]],
): DtChartSeries {
  return { key, name: key.toUpperCase(), unit, axis, points }
}

afterEach(() => {
  for (const token of PALETTE_TOKENS) {
    document.documentElement.style.removeProperty(token)
  }
})

describe('Y 轴分组', () => {
  it('两个分组各得一条轴，一左一右', () => {
    const option = buildLineOption([
      series('t', 'temperature', '℃'),
      series('h', 'humidity', '%'),
    ])
    expect(option.yAxis.map((axis) => axis.position)).toEqual(['left', 'right'])
    expect(option.yAxis.map((axis) => axis.name)).toEqual(['℃', '%'])
  })

  it('同一分组的多条系列共用一条轴', () => {
    const option = buildLineOption([
      series('t1', 'temperature', '℃'),
      series('t2', 'temperature', '℃'),
    ])
    expect(option.yAxis).toHaveLength(1)
    expect(option.series.map((item) => item.yAxisIndex)).toEqual([0, 0])
  })

  it('第三个分组回到左侧并往外让开一条轴的位置', () => {
    const option = buildLineOption([
      series('t', 'temperature', '℃'),
      series('h', 'humidity', '%'),
      series('p', 'pressure', 'kPa'),
    ])
    expect(option.yAxis[2]?.position).toBe('left')
    expect(option.yAxis[2]?.offset).toBeGreaterThan(0)
    expect(option.yAxis[0]?.offset).toBe(0)
  })

  it('系列按自己的分组挂轴，与出现顺序无关', () => {
    const option = buildLineOption([
      series('h', 'humidity', '%'),
      series('t', 'temperature', '℃'),
      series('h2', 'humidity', '%'),
    ])
    expect(option.series.map((item) => item.yAxisIndex)).toEqual([0, 1, 0])
  })

  it('只有第一条轴画分隔线，否则两套网格会叠在一起', () => {
    const option = buildLineOption([
      series('t', 'temperature', '℃'),
      series('h', 'humidity', '%'),
    ])
    expect(option.yAxis.map((axis) => axis.splitLine.show)).toEqual([
      true,
      false,
    ])
  })
})

describe('系列数据', () => {
  it('null 保持 null 且不连线——断档不是 0', () => {
    const option = buildLineOption([
      series('t', 'temperature', '℃', [
        [AT, 21.5],
        ['2026-08-12T02:56:00.000Z', null],
        ['2026-08-12T02:57:00.000Z', 22],
      ]),
    ])
    expect(option.series[0]?.connectNulls).toBe(false)
    expect(option.series[0]?.data.map(([, value]) => value)).toEqual([
      21.5,
      null,
      22,
    ])
  })

  it('系列 key 落成实例内 id，供更新时对齐', () => {
    const option = buildLineOption([
      series('workshop_temp_avg', 'temperature', '℃'),
    ])
    expect(option.series[0]?.id).toBe('workshop_temp_avg')
  })

  it('时间轴按时刻排，不按序号', () => {
    const option = buildLineOption([series('t', 'temperature', '℃')])
    expect(option.xAxis.type).toBe('time')
    expect(option.series[0]?.data[0]?.[0]).toBe(Date.UTC(2026, 7, 12, 2, 55))
  })
})

describe('空系列', () => {
  it('一条系列都没有时没有轴也没有系列，option 仍然完整', () => {
    const option = buildLineOption([])
    expect(option.yAxis).toEqual([])
    expect(option.series).toEqual([])
    expect(option.tooltip.trigger).toBe('axis')
  })
})

describe('配色', () => {
  it('token 都读得到时按 token 顺序给调色板', () => {
    document.documentElement.style.setProperty(
      '--accent-primary',
      'rgb(0, 206, 252)',
    )
    document.documentElement.style.setProperty(
      '--state-success',
      'rgb(20, 225, 68)',
    )
    const option = buildLineOption([series('t', 'temperature', '℃')])
    expect(option.color).toEqual(['rgb(0, 206, 252)', 'rgb(20, 225, 68)'])
  })

  it('一个 token 都读不到时整个 color 键不出现，让 echarts 用自带调色板', () => {
    const option = buildLineOption([series('t', 'temperature', '℃')])
    expect(option.color).toBeUndefined()
    expect('color' in option).toBe(false)
  })

  it('轴与文字的取色同样来自 token', () => {
    document.documentElement.style.setProperty(
      '--text-secondary',
      'rgb(255, 255, 255)',
    )
    const option = buildLineOption([series('t', 'temperature', '℃')])
    expect(option.xAxis.axisLabel.color).toBe('rgb(255, 255, 255)')
    document.documentElement.style.removeProperty('--text-secondary')
  })
})
