/**
 * @fileoverview 锁住表格的列与行：列由目录生成、插槽名与列名同源、
 * 断档显示成破折号而不是 0。
 */
import { describe, expect, it } from 'vitest'
import type { AcMetric, RawSample } from '@dt/contracts'

import {
  formatReading,
  toSampleColumns,
  toSampleRow,
} from '@/pages/Hvac/AcData/scripts/sampleTable'

function metric(key: string, name: string, unit: string): AcMetric {
  return {
    key,
    name,
    unit,
    group: 'temperature',
    is_limitable: false,
    is_charted_by_default: false,
  }
}

const CATALOG = [
  metric('workshop_temp_avg', '车间温度', '℃'),
  metric('fan_frequency', '送风机频率', 'Hz'),
]

function sample(over: Partial<RawSample> = {}): RawSample {
  const blank = {
    workshop_temp_avg: null,
    workshop_humidity_avg: null,
    ac_temp_setpoint: null,
    ac_humidity_setpoint: null,
    fresh_air_temp: null,
    fresh_air_humidity: null,
    supply_air_temp: null,
    supply_air_humidity: null,
    return_air_temp: null,
    return_air_humidity: null,
    mixed_air_temp: null,
    mixed_air_humidity: null,
    chilled_water_supply_temp: null,
    chilled_water_supply_pressure: null,
    heat_steam_temp: null,
    heat_steam_pressure: null,
    humidify_steam_temp: null,
    humidify_steam_pressure: null,
    fan_frequency: null,
  }
  return { ts: '2026-08-12T02:55:00.000Z', ...blank, ...over }
}

describe('toSampleColumns', () => {
  it('第一列是时刻，其余按目录顺序一个指标一列', () => {
    expect(toSampleColumns(CATALOG).map((item) => item.key)).toEqual([
      'ts',
      'workshop_temp_avg',
      'fan_frequency',
    ])
  })

  it('列头带上量纲', () => {
    expect(toSampleColumns(CATALOG)[1]?.label).toBe('车间温度（℃）')
  })

  it('没有量纲的指标不留一对空括号', () => {
    expect(toSampleColumns([metric('x', '无量纲量', '')])[1]?.label).toBe(
      '无量纲量',
    )
  })

  it('插槽名与列名同源，写错在结构上不可能发生', () => {
    for (const column of toSampleColumns(CATALOG)) {
      expect(column.slot).toBe(`cell-${column.key}`)
    }
  })

  it('目录为空时只剩时刻一列', () => {
    expect(toSampleColumns([])).toHaveLength(1)
  })
})

describe('formatReading', () => {
  it('null 显示成破折号——0 是一个真实读数，不能拿来顶替没采到', () => {
    expect(formatReading(null)).toBe('—')
    expect(formatReading(undefined)).toBe('—')
    expect(formatReading(0)).toBe('0')
  })

  it('抹掉浮点噪声，但不改变量级', () => {
    expect(formatReading(22.399999618530273)).toBe('22.4')
    expect(formatReading(20.15)).toBe('20.15')
    expect(formatReading(-3.5)).toBe('-3.5')
  })

  it('NaN 与 Infinity 也按没采到处理，不渲染成字面量', () => {
    expect(formatReading(Number.NaN)).toBe('—')
    expect(formatReading(Number.POSITIVE_INFINITY)).toBe('—')
  })
})

describe('toSampleRow', () => {
  it('行 id 取时刻，每个目录指标各出一个已格式化的单元格', () => {
    const row = toSampleRow(
      sample({ workshop_temp_avg: 21.5, fan_frequency: null }),
      CATALOG,
    )
    expect(row.id).toBe('2026-08-12T02:55:00.000Z')
    expect(row.cells.workshop_temp_avg).toBe('21.5')
    expect(row.cells.fan_frequency).toBe('—')
  })

  it('时刻按统一的格式化函数渲染，不是原样的 RFC3339', () => {
    const row = toSampleRow(sample(), CATALOG)
    expect(row.cells.ts).not.toBe('2026-08-12T02:55:00.000Z')
    expect(row.cells.ts).toContain('2026')
  })

  it('后端多给了目录里没有的键时不会多出一列', () => {
    const row = toSampleRow(sample({ workshop_humidity_avg: 55 }), CATALOG)
    expect(Object.keys(row.cells).sort()).toEqual([
      'fan_frequency',
      'ts',
      'workshop_temp_avg',
    ])
  })
})
