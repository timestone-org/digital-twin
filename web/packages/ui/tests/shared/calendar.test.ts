/**
 * @fileoverview 锁住日历面板的取值规则：月格按周一起头排、上下界按字典序夹取、
 * 溢出的日期归一而不是造出一个不存在的日子。
 *
 * ⚠ 这里全部按**本地时**算。日历要是拿 UTC 算日期，跨零点那几个小时整月都会
 * 差一天，而界面上看着完全正常。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  clampLocal,
  cursorOf,
  currentCursor,
  hourOptions,
  isDaySelectable,
  joinLocalMinute,
  minuteOptions,
  monthCells,
  shiftMonth,
  splitLocalMinute,
} from '../../src/shared/calendar'

const AUGUST = { year: 2026, month: 8 }

afterEach(() => {
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

describe('splitLocalMinute / joinLocalMinute', () => {
  it('拆得开也拼得回去', () => {
    const parts = splitLocalMinute('2026-08-12T10:55')
    expect(parts).toEqual({
      year: 2026,
      month: 8,
      day: 12,
      hour: 10,
      minute: 55,
    })
    expect(joinLocalMinute({ ...AUGUST, day: 12, hour: 10, minute: 55 })).toBe(
      '2026-08-12T10:55',
    )
  })

  it.each(['', '2026-08-12', '2026-08-12T10', 'abc'])(
    '形状不对（%s）时给 null',
    (raw) => {
      expect(splitLocalMinute(raw)).toBeNull()
    },
  )

  it('日期溢出时归一到下个月，而不是造出 2 月 31 日', () => {
    expect(
      joinLocalMinute({ year: 2026, month: 2, day: 31, hour: 0, minute: 0 }),
    ).toBe('2026-03-03T00:00')
  })

  it('补零补到位，年份四位', () => {
    expect(
      joinLocalMinute({ year: 2026, month: 1, day: 2, hour: 3, minute: 4 }),
    ).toBe('2026-01-02T03:04')
  })
})

describe('cursorOf / currentCursor / shiftMonth', () => {
  it('取值所在的年月；没有取值给 null', () => {
    expect(cursorOf('2026-08-12T10:55')).toEqual(AUGUST)
    expect(cursorOf('')).toBeNull()
  })

  it('当前年月按本地时区算', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-12T02:55:00.000Z'))
    vi.stubEnv('TZ', 'UTC')
    expect(currentCursor()).toEqual(AUGUST)
  })

  it('翻月跨年', () => {
    expect(shiftMonth({ year: 2026, month: 1 }, -1)).toEqual({
      year: 2025,
      month: 12,
    })
    expect(shiftMonth({ year: 2026, month: 12 }, 1)).toEqual({
      year: 2027,
      month: 1,
    })
  })
})

describe('monthCells', () => {
  it('格子数是 7 的整数倍，方便直接铺成网格', () => {
    expect(monthCells(AUGUST).length % 7).toBe(0)
  })

  it('周一起头：2026 年 8 月 1 日是周六，前面补 5 个空位', () => {
    const cells = monthCells(AUGUST)
    expect(cells.slice(0, 5).map((cell) => cell.day)).toEqual([
      null,
      null,
      null,
      null,
      null,
    ])
    expect(cells[5]?.day).toBe(1)
  })

  it('该有多少天就有多少天，二月按闰年算', () => {
    const days = (cursor: { year: number; month: number }): number =>
      monthCells(cursor).filter((cell) => cell.day !== null).length
    expect(days(AUGUST)).toBe(31)
    expect(days({ year: 2026, month: 2 })).toBe(28)
    expect(days({ year: 2024, month: 2 })).toBe(29)
  })

  it('每个格子的 key 唯一——补位格与日子混在同一列，下标做 key 会串行', () => {
    const keys = monthCells(AUGUST).map((cell) => cell.key)
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe('clampLocal', () => {
  it('界内原样放行', () => {
    expect(
      clampLocal('2026-08-12T10:00', '2026-08-01T00:00', '2026-08-31T23:59'),
    ).toBe('2026-08-12T10:00')
  })

  it('低于下界抬到下界，高于上界压到上界', () => {
    expect(clampLocal('2026-07-01T10:00', '2026-08-01T00:00', '')).toBe(
      '2026-08-01T00:00',
    )
    expect(clampLocal('2026-09-01T10:00', '', '2026-08-31T23:59')).toBe(
      '2026-08-31T23:59',
    )
  })

  it('空串表示不限，两端都空就是不夹', () => {
    expect(clampLocal('2026-08-12T10:00', '', '')).toBe('2026-08-12T10:00')
  })

  it('没有取值时不凭空造一个', () => {
    expect(clampLocal('', '2026-08-01T00:00', '')).toBe('')
  })
})

describe('isDaySelectable', () => {
  it('整天都在界外才禁用', () => {
    expect(isDaySelectable(AUGUST, 10, '2026-08-12T08:00', '')).toBe(false)
    expect(isDaySelectable(AUGUST, 20, '', '2026-08-12T08:00')).toBe(false)
  })

  it('下界当天只要还剩一分钟就可选', () => {
    expect(isDaySelectable(AUGUST, 12, '2026-08-12T23:59', '')).toBe(true)
  })

  it('上界当天同理', () => {
    expect(isDaySelectable(AUGUST, 12, '', '2026-08-12T00:00')).toBe(true)
  })

  it('没有上下界时哪天都可选', () => {
    expect(isDaySelectable(AUGUST, 1, '', '')).toBe(true)
  })
})

describe('时分选项', () => {
  it('小时 24 个、分钟 60 个，都补零显示', () => {
    expect(hourOptions()).toHaveLength(24)
    expect(minuteOptions()).toHaveLength(60)
    expect(hourOptions()[9]).toEqual({ value: '9', label: '09' })
    expect(minuteOptions()[59]).toEqual({ value: '59', label: '59' })
  })
})
