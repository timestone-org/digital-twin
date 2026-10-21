/** @fileoverview 季节配置的必填关系、年度日期和全年回退。 */
import { describe, expect, it } from 'vitest'
import type { LimitRow } from '@/pages/Hvac/Units/scripts/acLimitForm'
import {
  emptyWinter,
  seasonalPayload,
  validMonthDay,
  validateSeasonalLimits,
} from '@/pages/Hvac/Units/scripts/seasonalLimitForm'

function rows(): LimitRow[] {
  return [
    {
      metric: 'workshop_temp_avg',
      name: '温度',
      unit: '℃',
      group: 'temperature',
      lower: '20',
      upper: '24',
    },
    {
      metric: 'workshop_humidity_avg',
      name: '湿度',
      unit: '%RH',
      group: 'humidity',
      lower: '45',
      upper: '55',
    },
  ]
}

describe('年度日期', () => {
  it.each(['01-01', '02-29', '11-15', '12-31'])('%s 是有效月日', (value) => {
    expect(validMonthDay(value)).toBe(true)
  })
  it.each(['', '2-01', '02-30', '13-01', '00-01', '11-15\n'])(
    '拒绝无效月日 %s',
    (value) => {
      expect(validMonthDay(value)).toBe(false)
    },
  )
})

it('未启用冬季时只提交非冬季范围', () => {
  const winter = { ...emptyWinter(), rows: rows() }
  expect(validateSeasonalLimits(rows(), winter)).toBeNull()
  expect(seasonalPayload(rows(), winter)).toMatchObject({
    winter_period: null,
    winter: [],
  })
})

it('跨年冬季和两套完整范围可以提交', () => {
  const winter = { isEnabled: true, start: '11-15', end: '03-15', rows: rows() }
  expect(validateSeasonalLimits(rows(), winter)).toBeNull()
  expect(seasonalPayload(rows(), winter).winter_period).toEqual({
    start: '11-15',
    end: '03-15',
  })
})

it('启用后任一季缺少一个上下限都拒绝', () => {
  const incomplete = rows().map((row) => ({ ...row, upper: '' }))
  const winter = { isEnabled: true, start: '11-15', end: '03-15', rows: rows() }
  expect(validateSeasonalLimits(incomplete, winter)).toContain('都必须填写')
  expect(
    validateSeasonalLimits(rows(), { ...winter, rows: incomplete }),
  ).toContain('都必须填写')
})

it('不允许只填写一个冬季日期或遗漏湿度指标', () => {
  const winter = { isEnabled: true, start: '11-15', end: '', rows: rows() }
  expect(validateSeasonalLimits(rows(), winter)).toContain('日期')
  expect(
    validateSeasonalLimits(rows(), {
      ...winter,
      end: '03-15',
      rows: rows().slice(0, 1),
    }),
  ).toContain('都必须填写')
})
