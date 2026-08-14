/**
 * @fileoverview 时刻格式化：缺席、非法、合法三种入参各有确定的出参。
 */
import { describe, expect, it } from 'vitest'

import {
  formatDateTime,
  formatDay,
  formatMinuteStamp,
  formatMonthDay,
  formatSince,
} from '@/utils/datetime'

describe('formatDateTime', () => {
  it('取值缺席时给破折号而不是空白', () => {
    expect(formatDateTime(null)).toBe('—')
  })

  it('占位符可由调用方指定', () => {
    expect(formatDateTime(null, '从未登录')).toBe('从未登录')
  })

  it('非法时间给占位符而不是 Invalid Date', () => {
    expect(formatDateTime('nonsense')).toBe('—')
  })

  it('合法时间被渲染出来', () => {
    expect(formatDateTime('2026-08-10T09:30:00.000Z')).toContain('2026')
  })
})

describe('日期与分钟', () => {
  it('分钟戳到分不到秒，日期戳只到日', () => {
    const at = '2026-08-10T09:30:45.000Z'
    expect(formatMinuteStamp(at)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
    expect(formatDay(at)).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(formatMonthDay(at)).toMatch(/^\d{2}-\d{2}$/)
  })

  it('缺席与非法都给占位符，不给 Invalid Date', () => {
    expect(formatDay(null)).toBe('—')
    expect(formatDay(null, '未训练')).toBe('未训练')
    expect(formatMonthDay(null)).toBe('—')
    expect(formatMinuteStamp('nonsense')).toBe('—')
  })
})

describe('formatSince', () => {
  const now = new Date('2026-08-12T12:00:00.000Z')

  it('一分钟以内算「刚刚」', () => {
    expect(formatSince('2026-08-12T11:59:30.000Z', now)).toBe('刚刚')
  })

  it('⚠ 未来时刻（时钟偏差）也算「刚刚」，不写负数', () => {
    expect(formatSince('2026-08-12T12:05:00.000Z', now)).toBe('刚刚')
  })

  it('按分、时、天逐档进位', () => {
    expect(formatSince('2026-08-12T11:58:00.000Z', now)).toBe('2 分钟前')
    expect(formatSince('2026-08-12T09:00:00.000Z', now)).toBe('3 小时前')
    expect(formatSince('2026-08-10T12:00:00.000Z', now)).toBe('2 天前')
  })

  it('非法时间给占位符', () => {
    expect(formatSince('nonsense', now)).toBe('—')
  })
})
