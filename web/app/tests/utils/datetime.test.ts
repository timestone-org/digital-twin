/**
 * @fileoverview 时刻格式化：缺席、非法、合法三种入参各有确定的出参。
 */
import { describe, expect, it } from 'vitest'

import { formatDateTime } from '@/utils/datetime'

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
